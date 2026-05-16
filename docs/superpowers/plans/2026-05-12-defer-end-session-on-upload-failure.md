# Defer endSession on Upload Failure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `endRecording()` skip the automatic `endSession` call when any audio chunks fail to upload, so the consumer can retry uploads via `retryFailedUploads()` and explicitly call `endSession()` themselves when satisfied.

**Architecture:** Add a new `EndRecordingResult` type (manager-level) with a `sessionEnded` flag. Extract the "end session + cleanup + dispatch" tail of `RecordingManager.stop()` into a private `finalizeSession()` helper, then call it from two places: (1) `stop()` when uploads succeeded, (2) a new public `finalizeAfterExternalEndSession()` invoked by `ScribeClient.endSession()`. When uploads fail, `stop()` runs one extra internal retry pass; if anything still fails it performs partial cleanup (releases recorder, keeps `activeSession`/`retryContext`) and returns `sessionEnded: false`.

**Tech Stack:** TypeScript, no test framework installed — verification via `npm run typecheck` and code-path review. The user commits manually; do not run `git commit` in any task.

**Reference spec:** [docs/superpowers/specs/2026-05-12-defer-end-session-on-upload-failure-design.md](../specs/2026-05-12-defer-end-session-on-upload-failure-design.md)

---

## Files touched

- Modify: `src/types/recording.ts` — add `EndRecordingResult` type
- Modify: `src/recording/recording-manager.ts` — restructure `stop()`, add `finalizeSession()` and `finalizeAfterExternalEndSession()`
- Modify: `src/client.ts` — update `endRecording()` return type, augment `endSession()` with event dispatch + finalize wiring

No new files. No changes to recorders, transport, session manager internals, or worker.

---

## Task 1: Add `EndRecordingResult` type

**Files:**
- Modify: `src/types/recording.ts`
- Modify: `src/recording/recording-manager.ts` (return type only)
- Modify: `src/client.ts` (return type only)

This task only introduces the new type and threads it through return signatures. Manager behavior is unchanged — it sets `sessionEnded: true` on every return so the happy path stays identical.

- [ ] **Step 1: Add the new type**

Open `src/types/recording.ts`. Find the existing `StopRecordingResult` interface (lines 38-42). Leave it as-is — it remains the recorder-level shape. After it, add a new manager-level type:

```ts
/**
 * Result of ScribeClient.endRecording() / RecordingManager.stop().
 *
 * Extends recorder-level StopRecordingResult with session-finalization info:
 * - sessionEnded: false when uploads failed and the consumer must call
 *   scribe.endSession() explicitly after retrying.
 * - endSessionResponse: present only when sessionEnded === true.
 */
export interface EndRecordingResult extends StopRecordingResult {
  sessionEnded: boolean;
  endSessionResponse?: EndSessionResponse;
}
```

Then remove the `endSessionResponse?: EndSessionResponse;` line from `StopRecordingResult` — that field is a manager-level concern, not a recorder concern. The recorders never set it (verify by grepping). The final `StopRecordingResult` should be:

```ts
export interface StopRecordingResult {
  failedUploads: string[];
  totalFiles: number;
}
```

- [ ] **Step 2: Update `RecordingManager.stop()` signature and returns**

Open `src/recording/recording-manager.ts`. Add `EndRecordingResult` to the existing type import at the top (around line 23-29):

```ts
import type {
  IRecorder,
  RecordingOptions,
  RecorderConfig,
  StopRecordingResult,
  EndRecordingResult,
  RetryUploadResult,
} from '../types/recording';
```

Change the return type of `stop()` (around line 328):

```ts
async stop(): Promise<EndRecordingResult> {
```

Update every `return` inside `stop()` to include `sessionEnded`. There are three return points to update:

1. Early-return at the top when there's nothing to stop (~line 330):

   ```ts
   if (!this.recorder || !this._isRecording) {
     return { failedUploads: [], totalFiles: 0, sessionEnded: false };
   }
   ```

2. The main result construction (~line 341). Replace `const result: StopRecordingResult = { ...stopResult };` with:

   ```ts
   const result: EndRecordingResult = { ...stopResult, sessionEnded: false };
   ```

   Inside the `if (this.activeSession)` block, after `endResponse` is set successfully (~line 355), set `result.sessionEnded = true;` right before `result.endSessionResponse = endResponse;`.

3. The error-path return at the bottom of `stop()` (~line 405):

   ```ts
   return { failedUploads: [], totalFiles: 0, sessionEnded: false };
   ```

- [ ] **Step 3: Update `ScribeClient.endRecording()` signature**

Open `src/client.ts`. Update the type import at line 45:

```ts
import type { StopRecordingResult, EndRecordingResult, RetryUploadResult } from './types/recording';
```

`StopRecordingResult` is no longer used directly in `client.ts` after this change — remove it from the import if no other reference exists (search the file for `StopRecordingResult` after editing). Final import:

```ts
import type { EndRecordingResult, RetryUploadResult } from './types/recording';
```

Change `endRecording()` return type (line 190):

```ts
async endRecording(): Promise<SDKResult<EndRecordingResult>> {
  return this.wrapResult(() => this.recordingManager.stop());
}
```

- [ ] **Step 4: Verify**

Run from the repo root:

```bash
npm run typecheck
```

Expected: exits with code 0, no errors. If errors mention `StopRecordingResult.endSessionResponse` or a missing `sessionEnded`, fix the offending site and re-run.

---

## Task 2: Extract `finalizeSession()` helper (no behavior change)

**Files:**
- Modify: `src/recording/recording-manager.ts`

Pull the "end session + dispatch + cleanup" tail out of `stop()` into a reusable private method. Behavior must stay identical — this is a pure refactor that sets up Task 3 and Task 4.

- [ ] **Step 1: Add the new private method**

Open `src/recording/recording-manager.ts`. After the `stop()` method (right before `forceStop()`, around line 412), insert:

```ts
/**
 * End the session, dispatch onSessionEvent, and return the response.
 *
 * Called from stop() when uploads succeeded, and from
 * finalizeAfterExternalEndSession() when the consumer drives finalization.
 *
 * Returns undefined and dispatches an onError if the server call fails.
 * Caller is responsible for cleanupRecordingState().
 */
private async finalizeSession(
  totalFiles: number,
  successfulUploads: number
): Promise<EndSessionResponse | undefined> {
  if (!this.activeSession) {
    return undefined;
  }

  try {
    const endResponse = await this.sessionManager.endSession(
      this.activeBaseUrl,
      {
        audio_files_sent: totalFiles,
        audio_files_uploaded: successfulUploads,
      },
      this.activeSession.session_id
    );

    this.callbackRegistry.dispatch('onSessionEvent', {
      type: 'ended',
      timestamp: new Date().toISOString(),
      data: endResponse,
    });

    return endResponse;
  } catch (error) {
    console.error('[ScribeSDK] Failed to end session:', error);
    this.callbackRegistry.dispatch('onError', {
      type: 'transport_error',
      timestamp: new Date().toISOString(),
      error: {
        code: 'session_end_failed',
        message: error instanceof Error ? error.message : 'Failed to end session',
      },
    });
    return undefined;
  }
}
```

The `EndSessionResponse` import — check the top of the file. `CreateSessionResponse` is already imported from `'../types/session'`. Add `EndSessionResponse` to that import:

```ts
import type { CreateSessionRequest, CreateSessionResponse, EndSessionResponse } from '../types/session';
```

- [ ] **Step 2: Call `finalizeSession()` from `stop()`**

Replace the inline `endSession` block inside `stop()` (lines 343-374, the entire `if (this.activeSession) { try { ... } catch { ... } }` block) with:

```ts
if (this.activeSession) {
  const successfulUploads = stopResult.totalFiles - stopResult.failedUploads.length;
  const endResponse = await this.finalizeSession(stopResult.totalFiles, successfulUploads);
  if (endResponse) {
    result.sessionEnded = true;
    result.endSessionResponse = endResponse;
  }
}
```

`result` should already be typed as `EndRecordingResult` from Task 1. Verify the `result` declaration directly above this block looks like:

```ts
const result: EndRecordingResult = { ...stopResult, sessionEnded: false };
```

- [ ] **Step 3: Verify**

Run:

```bash
npm run typecheck
```

Expected: exits with code 0. Open `src/recording/recording-manager.ts` and visually confirm:
- `stop()` is shorter, with one call to `this.finalizeSession(...)`.
- `finalizeSession()` exists right after `stop()`.
- The `result.sessionEnded = true` assignment only happens when `endResponse` is truthy.
- Cleanup (`cleanupRecordingState()`) still happens in the `finally` block — unchanged.

---

## Task 3: Internal auto-retry pass + skip-finalize branch

**Files:**
- Modify: `src/recording/recording-manager.ts`

Add the core behavior change: when uploads fail, run one internal retry pass via the existing `retryFailedUploads()` logic. If anything still fails after that, skip `finalizeSession()`, do partial cleanup (release the recorder but keep `activeSession`/`activeBaseUrl`/`retryContext`), and return `sessionEnded: false`.

- [ ] **Step 1: Replace the post-stop block in `stop()`**

In `src/recording/recording-manager.ts`, locate the section in `stop()` that runs after `preserveRetryContext()` and before the `} catch` of the outer try (roughly lines 338-389 after Task 2's edits). Currently it looks like (post-Task-2):

```ts
// 2. Preserve failed chunks for retry before cleanup destroys state
this.preserveRetryContext();

// 3. End session — tell the server how many files we sent/uploaded
const result: EndRecordingResult = { ...stopResult, sessionEnded: false };

if (this.activeSession) {
  const successfulUploads = stopResult.totalFiles - stopResult.failedUploads.length;
  const endResponse = await this.finalizeSession(stopResult.totalFiles, successfulUploads);
  if (endResponse) {
    result.sessionEnded = true;
    result.endSessionResponse = endResponse;
  }
}

// 4. Dispatch recording ended
this.callbackRegistry.dispatch('onRecordingStateChange', {
  type: 'ended',
  timestamp: new Date().toISOString(),
  data: result,
});

if (this.config.debug) {
  console.log('[ScribeSDK] Recording stopped:', {
    totalFiles: result.totalFiles,
    failedUploads: result.failedUploads.length,
  });
}

return result;
```

Replace that whole section (from `this.preserveRetryContext();` down to `return result;`) with:

```ts
// 2. Preserve failed chunks for retry before cleanup destroys state
this.preserveRetryContext();

// 3. If any uploads failed, run one internal retry pass to catch transient blips
//    that lasted longer than the transport's built-in retry window.
let currentFailedUploads = stopResult.failedUploads;
if (currentFailedUploads.length > 0) {
  try {
    const retryResult = await this.retryFailedUploads();
    currentFailedUploads = retryResult.stillFailed;
  } catch (retryError) {
    // Retry pass itself blew up — keep original failures and surface via onError.
    console.error('[ScribeSDK] Internal retry pass failed:', retryError);
    this.callbackRegistry.dispatch('onError', {
      type: 'transport_error',
      timestamp: new Date().toISOString(),
      error: {
        code: 'internal_retry_failed',
        message: retryError instanceof Error ? retryError.message : 'Retry pass failed',
      },
    });
  }
}

const result: EndRecordingResult = {
  failedUploads: currentFailedUploads,
  totalFiles: stopResult.totalFiles,
  sessionEnded: false,
};

// 4. End session only if every chunk uploaded successfully.
if (currentFailedUploads.length === 0 && this.activeSession) {
  const endResponse = await this.finalizeSession(
    stopResult.totalFiles,
    stopResult.totalFiles
  );
  if (endResponse) {
    result.sessionEnded = true;
    result.endSessionResponse = endResponse;
  }
}

// 5. Dispatch recording ended
this.callbackRegistry.dispatch('onRecordingStateChange', {
  type: 'ended',
  timestamp: new Date().toISOString(),
  data: result,
});

if (this.config.debug) {
  console.log('[ScribeSDK] Recording stopped:', {
    totalFiles: result.totalFiles,
    failedUploads: result.failedUploads.length,
    sessionEnded: result.sessionEnded,
  });
}

return result;
```

Note: the internal call is `this.retryFailedUploads()` (the existing public method on the manager). That method:
- Guards on `_isRecording` — we're inside `stop()`, but `_isRecording` is still `true` at this point. **This is a problem.** Look at `stop()`: `_isRecording` is set to `false` only in `cleanupRecordingState()` which runs in `finally`. So a call to `retryFailedUploads()` from inside `stop()` will throw `ScribeError('Cannot retry uploads while recording is active.')`.

  Fix: set `this._isRecording = false;` immediately after `preserveRetryContext()` and before the retry call. The recorder has already stopped — we're past the point where "recording" is meaningful. Update the code above so the section starts with:

  ```ts
  // 2. Preserve failed chunks for retry before cleanup destroys state
  this.preserveRetryContext();

  // Recorder has stopped — mark not-recording so retryFailedUploads() doesn't refuse.
  this._isRecording = false;

  // 3. If any uploads failed, run one internal retry pass...
  ```

- Returns `{ retried, succeeded, stillFailed }` — we use `stillFailed`.
- Each retry already dispatches `onUploadEvent: 'progress' | 'failed'`, so consumers see consistent events.

- [ ] **Step 2: Change the `finally` block to do conditional cleanup**

Locate the `finally` block at the end of `stop()` (around line 406):

```ts
} finally {
  // 5. Clean up regardless of success/failure
  this.cleanupRecordingState();
}
```

Replace it with conditional cleanup based on `sessionEnded`. We need access to `result.sessionEnded` from the `finally`, so hoist the variable. The cleanest pattern: track session-ended outcome in an outer-scoped variable.

Adjust the structure of `stop()` so the result-flag is visible in `finally`. At the top of `stop()` after the early-return guard, declare:

```ts
let sessionEnded = false;
```

Then in the success-path block, after `result.sessionEnded = true;`, also do `sessionEnded = true;`. In the catch-path of `stop()` (the outer `catch (error)` at ~line 392), `sessionEnded` stays `false`.

Then change the `finally` to:

```ts
} finally {
  // Cleanup logic:
  // - sessionEnded === true:  full cleanup (drop session, retry context, everything).
  // - sessionEnded === false: partial cleanup — release recorder/mic/worker, but keep
  //   activeSession + activeBaseUrl + retryContext so the consumer can retry uploads
  //   and call scribe.endSession() explicitly later.
  if (sessionEnded) {
    this.cleanupRecordingState();
  } else {
    this.partialCleanupAfterFailedFinalize();
  }
}
```

- [ ] **Step 3: Add `partialCleanupAfterFailedFinalize()`**

Add a new private method near `cleanupRecordingState()` (near line 672):

```ts
/**
 * Release the recorder (mic, VAD, worker) but preserve session + retry context
 * so the consumer can call retryFailedUploads() and endSession() explicitly.
 *
 * Used when stop() decides the session is NOT being ended automatically because
 * uploads still failed after the internal retry pass.
 */
private partialCleanupAfterFailedFinalize(): void {
  this.recorder = null;
  this._isRecording = false;
  this._isStarting = false;
  // Deliberately preserved: activeSession, activeBaseUrl, retryContext
}
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run typecheck
```

Expected: exits with code 0.

Then trace the logic by reading `stop()` end-to-end. Confirm these flows:

1. **No failures:** `stopResult.failedUploads = []` → skip retry pass → `currentFailedUploads.length === 0` → call `finalizeSession` → `sessionEnded = true` → full cleanup. **Identical to today.**
2. **Failures, all recover on internal retry:** `stopResult.failedUploads.length > 0` → run `retryFailedUploads()` → `stillFailed = []` → call `finalizeSession` → `sessionEnded = true` → full cleanup.
3. **Failures, some still failing after internal retry:** `stillFailed.length > 0` → skip `finalizeSession` → `sessionEnded = false` → partial cleanup → `result.failedUploads = stillFailed`, `result.sessionEnded = false`, no `endSessionResponse`.

Verify `hasFailedUploads()` (line 478) returns `true` in case 3 since `retryContext.failedChunks` is non-empty (the existing `retryFailedUploads()` updates `retryContext` to keep only `stillFailed` chunks — line 552-554).

---

## Task 4: Consumer-driven finalize path (`ScribeClient.endSession()`)

**Files:**
- Modify: `src/recording/recording-manager.ts`
- Modify: `src/client.ts`

When the consumer calls `scribe.endSession()` after a failed `endRecording()`, the SDK must:
1. Dispatch `onSessionEvent: 'ended'` on success (currently only dispatched from `RecordingManager.stop()`).
2. Clean up the recording manager's preserved state (`activeSession`, `activeBaseUrl`, `retryContext`) if the ended session matches the active one.

- [ ] **Step 1: Add `finalizeAfterExternalEndSession()` on `RecordingManager`**

In `src/recording/recording-manager.ts`, add a public method (place it after `retryFailedUploads()`, around line 562):

```ts
/**
 * Called by ScribeClient.endSession() after a successful external endSession call.
 * Clears the preserved recording-manager state (activeSession, activeBaseUrl,
 * retryContext) when the ended session matches our active one.
 *
 * If the consumer ended a different session (e.g. one they created via
 * createSession()), we leave our state alone.
 */
finalizeAfterExternalEndSession(sessionId: string): void {
  if (!this.activeSession) {
    return;
  }
  if (this.activeSession.session_id !== sessionId) {
    return;
  }
  this.activeSession = null;
  this.activeBaseUrl = '';
  this.retryContext = null;
}
```

- [ ] **Step 2: Wire `ScribeClient.endSession()` to dispatch event + finalize**

Open `src/client.ts`. Find `endSession()` (around line 240):

```ts
async endSession(
  request: EndSessionRequest,
  sessionId?: string
): Promise<SDKResult<EndSessionResponse>> {
  const baseUrl = this.getEffectiveBaseUrl();
  return this.wrapResult(() => this.sessionManager.endSession(baseUrl, request, sessionId));
}
```

Replace with:

```ts
async endSession(
  request: EndSessionRequest,
  sessionId?: string
): Promise<SDKResult<EndSessionResponse>> {
  const baseUrl = this.getEffectiveBaseUrl();
  return this.wrapResult(async () => {
    const response = await this.sessionManager.endSession(baseUrl, request, sessionId);

    // Resolve the session id we actually ended (sessionManager falls back to currentSession).
    const endedSessionId =
      sessionId ?? this.recordingManager.getActiveSession()?.session_id;

    if (endedSessionId) {
      this.recordingManager.finalizeAfterExternalEndSession(endedSessionId);
    }

    this.callbackRegistry.dispatch('onSessionEvent', {
      type: 'ended',
      timestamp: new Date().toISOString(),
      data: response,
    });

    return response;
  });
}
```

Note on the session-id resolution: when the caller omits `sessionId`, `sessionManager.endSession()` uses `this.currentSession?.session_id`. By the time the response arrives, `sessionManager` has cleared `currentSession` (see `session-manager.ts:122-124`). So we read the id from the recording manager's `getActiveSession()` instead — that's preserved through the failed-endRecording flow precisely so we can match it here. If the consumer ended a different session ad-hoc, they passed `sessionId` explicitly, and we use that.

- [ ] **Step 3: Verify**

Run:

```bash
npm run typecheck
```

Expected: exits with code 0.

Then trace these flows by reading the code:

1. **Happy path through `endRecording()`:** `RecordingManager.stop()` dispatches `onSessionEvent: 'ended'` from inside `finalizeSession()`. `ScribeClient.endSession()` is never called. No duplicate event.
2. **Failed-endRecording → consumer retries → consumer calls `scribe.endSession()`:** `recordingManager.getActiveSession()` returns the preserved session. `finalizeAfterExternalEndSession()` clears the preserved state. Event fires. State is clean.
3. **Standalone `scribe.endSession()` (consumer created a session via `createSession()`, no recording involved):** `recordingManager.getActiveSession()` returns `null` (no recording happened). `endedSessionId` may still be set if the caller passed `sessionId` explicitly. `finalizeAfterExternalEndSession()` is called but exits early (its `activeSession === null` guard). Event fires. No state corruption.
4. **Consumer calls `scribe.endSession(req, otherSessionId)` while a recording-manager session is preserved:** `finalizeAfterExternalEndSession(otherSessionId)` is called; it returns early because `otherSessionId !== activeSession.session_id`. Preserved state stays intact. Event fires for the other session. The pending recording is left alone.

---

## Task 5: Update JSDoc on public surface

**Files:**
- Modify: `src/client.ts`

Make the new behavior discoverable from the SDK's surface comments. No code logic changes.

- [ ] **Step 1: Update `endRecording()` JSDoc**

In `src/client.ts`, replace the comment above `endRecording()` (around line 187-189):

```ts
/**
 * End the active recording — stops recorder, waits for uploads, ends session.
 */
```

With:

```ts
/**
 * End the active recording.
 *
 * Stops the recorder, flushes pending audio, waits for uploads, and — if
 * everything uploaded — ends the session. If any chunks failed to upload,
 * the SDK runs one internal retry pass; if files still fail, the session
 * is NOT ended and the result reports `sessionEnded: false`.
 *
 * On `sessionEnded: false`, the consumer should:
 *   1. Optionally call `retryFailedUploads()` one or more times.
 *   2. Call `endSession({ audio_files_sent, audio_files_uploaded })` to
 *      finalize. The active session is preserved until then.
 */
```

- [ ] **Step 2: Update `endSession()` JSDoc**

Replace the comment above `endSession()` (around line 236-239):

```ts
/**
 * End a session directly (without stopping a recording).
 * Uses the current active session if no sessionId is provided.
 */
```

With:

```ts
/**
 * End a session directly.
 *
 * Use this when:
 *   - You created a session via `createSession()` and want to end it without
 *     ever recording.
 *   - `endRecording()` returned `sessionEnded: false` (uploads failed) and
 *     you've finished retrying — pass the totals you want the server to see.
 *
 * On success, dispatches `onSessionEvent: 'ended'` and clears any preserved
 * recording state for that session. If `sessionId` is omitted, uses the
 * current active session.
 */
```

- [ ] **Step 3: Update `retryFailedUploads()` JSDoc**

Replace the comment above `retryFailedUploads()` (around line 194-198):

```ts
/**
 * Retry uploading audio files that failed during the last recording.
 * Only available after endRecording() returned failed uploads.
 * Cleared on reset() or next startRecording().
 */
```

With:

```ts
/**
 * Retry uploading audio files that failed during the last recording.
 *
 * Available after `endRecording()` returns `sessionEnded: false` (or any time
 * `hasFailedUploads()` is true). After retrying, call `endSession()` to
 * finalize. Retry context is cleared on `reset()` or the next `startRecording()`.
 */
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run typecheck
```

Expected: exits with code 0.

Open each modified JSDoc block and read it. Confirm the descriptions match the implementation in `stop()` and `endSession()`.

---

## Final verification

After all five tasks:

- [ ] Run `npm run typecheck` from the repo root. Expected: exits with code 0.
- [ ] Run `npm run build` from the repo root. Expected: exits with code 0; `dist/` is regenerated. (The repo has no test suite — build success is the strongest automated signal.)
- [ ] Manually re-read `src/recording/recording-manager.ts` end-to-end:
  - `stop()` does: stop recorder → preserve retry → set `_isRecording=false` → internal retry pass (if needed) → finalize OR partial-cleanup → dispatch state change → return.
  - `finalizeSession()` is the only place that calls `sessionManager.endSession()` from within recording-manager.
  - `finalizeAfterExternalEndSession()` only clears state when the session id matches.
- [ ] Manually re-read `src/client.ts`:
  - `endRecording()` returns `SDKResult<EndRecordingResult>`.
  - `endSession()` dispatches `onSessionEvent: 'ended'` exactly once per successful call and calls `recordingManager.finalizeAfterExternalEndSession()`.
- [ ] Notify user that implementation is complete and ready for their review/commit. **Do not commit.**

---

## Self-review notes

**Spec coverage check:**
- "endRecording skips endSession on failure" → Task 3 step 1 (`if (currentFailedUploads.length === 0 && this.activeSession)`).
- "one internal auto-retry pass" → Task 3 step 1.
- "consumer calls endSession() explicitly" → Task 4 step 2.
- "StopRecordingResult gains sessionEnded" → realized as `EndRecordingResult extends StopRecordingResult` in Task 1 (cleaner: recorder-level shape stays free of manager concerns).
- "ScribeClient.endSession() dispatches onSessionEvent + clears state" → Task 4 step 2.
- "Happy path identical to today" → confirmed by Task 3 step 4 trace #1.
- "Partial cleanup keeps activeSession/retryContext, releases recorder" → Task 3 step 3 (`partialCleanupAfterFailedFinalize`).
- "Events: onRecordingStateChange always fires, onSessionEvent only on actual end" → Task 3 step 1 (dispatch is unconditional for state change, `finalizeSession` is conditional).

**Placeholder scan:** No TBDs. All code blocks contain real code. No "implement appropriate X". Method names (`finalizeSession`, `finalizeAfterExternalEndSession`, `partialCleanupAfterFailedFinalize`) are used consistently across tasks.

**Behavioral gap intentionally addressed:** `_isRecording` flag is flipped to false before calling `retryFailedUploads()` inside `stop()` — without this fix, the internal retry would throw. Documented in Task 3 step 1.
