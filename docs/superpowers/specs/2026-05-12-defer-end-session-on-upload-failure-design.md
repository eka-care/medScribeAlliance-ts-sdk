# Defer endSession when uploads failed

**Status:** Draft
**Date:** 2026-05-12
**Author:** Sanika Goyal

## Problem

`ScribeClient.endRecording()` today unconditionally ends the session after the recorder stops, even when some audio chunks failed to upload. The server is told "we sent X, uploaded Y" with a partial count and may begin processing an incomplete recording. The SDK already preserves failed chunks for retry via `retryFailedUploads()`, but the session has already been ended by the time the consumer gets a chance to retry — too late to deliver the missing audio as part of the same session.

The expected behavior: when uploads fail, `endRecording()` should surface the failure to the consumer, give them a chance to recover, and only end the session once they're satisfied.

## Goals

- `endRecording()` does not end the session if any chunks failed to upload.
- Consumer can call `retryFailedUploads()` zero or more times to recover failed chunks.
- Consumer explicitly calls `endSession()` when they're done — either because all chunks are uploaded, or because they've given up.
- The happy path (no failures) is unchanged: same behavior, no extra latency.
- Existing transport retry behavior (3 retries with backoff per upload) is unchanged.

## Non-goals

- Changing transport-layer retry policy.
- Changing `cancelSession()` or `forceStop()` semantics.
- Persisting failed chunks across page reloads or process restarts.
- Adding any new method beyond what already exists in `ScribeClient`.

## Current flow

`ScribeClient.endRecording()` → `RecordingManager.stop()`:

1. `recorder.stop()` — flushes the last chunk, waits for in-flight uploads. Transport has already retried each upload 3× with backoff.
2. `preserveRetryContext()` — copies failed chunks (filename + blob) to `retryContext` for later retry.
3. `sessionManager.endSession(baseUrl, { audio_files_sent, audio_files_uploaded }, sessionId)` — **always called, regardless of failures**. Counts reflect partial state if some uploads failed.
4. Dispatches `onSessionEvent: 'ended'` and `onRecordingStateChange: 'ended'`.
5. `cleanupRecordingState()` — clears recorder, active session, base URL, `_isRecording`. `retryContext` is preserved (not cleared) for subsequent `retryFailedUploads()` calls.

`retryFailedUploads()` already works after `endRecording()` — but the session has been ended, so any successful retries arrive after the server has been told the upload phase is complete.

## Proposed flow

`RecordingManager.stop()` becomes:

1. `recorder.stop()` — unchanged.
2. `preserveRetryContext()` — unchanged.
3. **If `stopResult.failedUploads.length > 0`:** run one internal retry pass via the existing `retryFailedUploads()` logic. This catches transient blips that lasted longer than the transport's ~6 s retry window.
   - After the pass, recompute `failedUploads` from the updated `retryContext`.
4. **If failures remain after the auto-retry pass:**
   - Skip `endSession()`.
   - Skip `cleanupRecordingState()` — keep `activeSession`, `activeBaseUrl`, `retryContext` so the consumer can retry further and call `endSession()` later.
   - Still clear `recorder` (release VAD, mic, worker) and set `_isRecording = false`.
   - Dispatch `onRecordingStateChange: 'ended'` with the current result.
   - Do **not** dispatch `onSessionEvent: 'ended'` (the session isn't ended yet).
   - Return `{ failedUploads, totalFiles, sessionEnded: false }`.
5. **If all uploads succeeded (post-retry or originally):**
   - Call `endSession()` with full counts.
   - Dispatch `onSessionEvent: 'ended'`.
   - Dispatch `onRecordingStateChange: 'ended'`.
   - Full `cleanupRecordingState()` including clearing `retryContext`.
   - Return `{ failedUploads: [], totalFiles, sessionEnded: true, endSessionResponse }`.

Consumer flow:

```ts
const result = await scribe.endRecording();
if (!result.success) { /* handle */ return; }

if (result.data.sessionEnded) {
  return; // happy path, done
}

let stillFailing = result.data.failedUploads;
for (let i = 0; i < userMaxRetries && stillFailing.length > 0; i++) {
  const retry = await scribe.retryFailedUploads();
  if (!retry.success) break;
  stillFailing = retry.data.stillFailed;
}

await scribe.endSession({
  audio_files_sent: result.data.totalFiles,
  audio_files_uploaded: result.data.totalFiles - stillFailing.length,
});
```

## API changes

### `StopRecordingResult`

Add `sessionEnded: boolean`. When `false`, `endSessionResponse` is absent and the consumer is responsible for finalizing.

```ts
export interface StopRecordingResult {
  failedUploads: string[];
  totalFiles: number;
  sessionEnded: boolean;
  endSessionResponse?: EndSessionResponse;
}
```

### `ScribeClient.endSession()`

Currently a thin pass-through to `sessionManager.endSession()`. Now also:

- Dispatches `onSessionEvent: 'ended'` with the response data on success.
- Clears the recording manager's `activeSession`, `activeBaseUrl`, and `retryContext` if the ended session matches the active one. (If consumer passes a different `sessionId`, leave active state alone.)

This gives the consumer-driven finalize path event parity with the auto-finalize path.

A new internal method on `RecordingManager` — `finalizeAfterExternalEndSession(sessionId)` — handles the cleanup, called from `ScribeClient.endSession()` after a successful response.

### Everything else

- `retryFailedUploads()` — unchanged signature and semantics.
- `hasFailedUploads()` — unchanged.
- `cancelSession()`, `forceStop()` — unchanged.
- Transport retry policy — unchanged.
- `startRecording()` while `retryContext` is non-empty — still allowed; it clears `retryContext` as today. We're not adding a guard. (The consumer can check `hasFailedUploads()` if they want to warn.)

## State lifecycle

| State after `endRecording()` | `sessionEnded: true` | `sessionEnded: false` |
|---|---|---|
| `recorder` | `null` | `null` |
| `_isRecording` | `false` | `false` |
| `activeSession` | `null` | preserved |
| `activeBaseUrl` | `''` | preserved |
| `retryContext` | `null` | preserved (one or more failed chunks) |
| `getCurrentSession()` | returns `null` | returns the session |
| `hasFailedUploads()` | `false` | `true` |

After the consumer's explicit `endSession()` succeeds, the `sessionEnded: false` row collapses into the `sessionEnded: true` row.

## Events

- `onRecordingStateChange: 'ended'` — fires once after `recorder.stop()` completes (timing unchanged from today).
- `onSessionEvent: 'ended'` — fires when the session actually ends, from either path:
  - Auto-finalize path: dispatched from `RecordingManager.stop()` after `sessionManager.endSession()` succeeds (today's behavior).
  - Consumer-driven path: dispatched from `ScribeClient.endSession()` after `sessionManager.endSession()` succeeds.
- `onUploadEvent: 'progress' | 'failed'` — fired from the internal auto-retry pass too, identical to consumer-driven `retryFailedUploads()`. Consumers see consistent events whether retries are SDK-internal or consumer-explicit.

## Error handling

- Internal auto-retry pass uses the same `retryFailedUploads()` code path. Any thrown error there is caught and treated as "still failing" — does not blow up `endRecording()`.
- If `endSession()` itself fails (network, 4xx, etc.) on the auto-finalize path: today this is swallowed and dispatched as `onError`. Unchanged.
- If `endSession()` fails on the consumer-driven path: surfaces as `SDKResult.error` to the consumer. They can retry the call.
- `endRecording()` always returns success (`SDKResult.success: true`) when the recorder stopped cleanly — even if uploads failed. The `sessionEnded` flag carries the meaning. This keeps the `success/error` boundary about "did the operation execute" rather than "was everything perfect."

## Backwards compatibility

- `StopRecordingResult` gains a required field. Any consumer destructuring `endSession` already has to handle the optional `endSessionResponse`. Adding `sessionEnded` is a TypeScript-level break for anyone using strict types but not narrowing on it; runtime behavior is fine.
- `ScribeClient.endSession()` now has side effects (event dispatch, state cleanup). Consumers who relied on it being a no-state call need to be aware. We document this in the JSDoc.
- The happy path (no failed uploads) is byte-identical to today.

## Implementation outline

Touch points:

1. `src/types/recording.ts` — add `sessionEnded` to `StopRecordingResult`.
2. `src/recording/recording-manager.ts` —
   - Split `stop()`: extract the "end session + cleanup" tail into a private method (e.g., `finalizeSession()`) shared by the auto-finalize and consumer-driven paths.
   - In `stop()`, after `preserveRetryContext()`, branch on `retryContext`:
     - No failures → call `finalizeSession()` → return with `sessionEnded: true`.
     - Failures → run internal retry pass → re-check → finalize or partial-cleanup accordingly.
   - Add public `finalizeAfterExternalEndSession(sessionId)` for the consumer-driven path.
3. `src/client.ts` — `endSession()` wraps the transport call, then dispatches `onSessionEvent: 'ended'` and calls `recordingManager.finalizeAfterExternalEndSession()`.

## Open risks

- **Consumer forgets to call `endSession()`**: session is orphaned server-side. Mitigation: documentation; `sessionEnded: false` is explicit; we could later add a console warning if `startRecording()` is called with a pending unfinalized session, but not in scope for this design.
- **Auto-retry pass adds latency to `endRecording()`** for the failed case. Each retry is up to ~6 s (3 retries × 2 s backoff). For N failed files this is bounded but noticeable. Acceptable: the alternative is the consumer experiencing the same latency themselves on the first `retryFailedUploads()` call.
- **`retryContext` lives across an unfinalized session into the next `startRecording()`** if the consumer ignores the failure. Today's behavior already clears it on next start; preserved.
