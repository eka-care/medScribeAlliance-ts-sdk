# MedScribe Alliance TS SDK

TypeScript SDK for the [MedScribe Alliance Protocol](https://github.com/MedScribeAlliance/scribe-emr-protocol) — handles discovery, recording, audio chunking (VAD), MP3 compression, upload, session lifecycle, and output retrieval.

## Installation

```bash
npm install med-scribe-alliance-ts-sdk
```

Peer dependencies (installed automatically):

- `@ricky0123/vad-web` — Voice Activity Detection
- `@breezystack/lamejs` — MP3 encoding
- `zod` — Schema validation

## Quick Start

```ts
import { ScribeClient } from 'med-scribe-alliance-ts-sdk';

const client = new ScribeClient({
  baseUrl: 'https://api.example.com/voice/api/v2',
  accessToken: 'your-bearer-token',
});

// Register callbacks
client.registerCallback('onUploadEvent', (event) => {
  if (event.type === 'progress') {
    console.log(`Uploaded ${event.data.successCount}/${event.data.totalCount}`);
  }
});

client.registerCallback('onError', (event) => {
  console.error(`[${event.error.code}] ${event.error.message}`);
});

// Start recording — creates session, starts mic, begins chunked upload
const result = await client.startRecording({
  templates: ['soap', 'prescription'],
  uploadType: 'chunked',
});

if (!result.success) {
  console.error(result.error);
}

// ... user speaks ...

// Stop recording — flushes remaining audio, waits for uploads, ends session
const stopResult = await client.endRecording();

if (stopResult.success) {
  console.log(`${stopResult.data.totalFiles} files uploaded`);
  console.log(`${stopResult.data.failedUploads.length} failed`);
}

// Poll for results
const status = await client.getSessionStatus(result.data.session_id, {
  poll: {
    maxAttempts: 60,
    intervalMs: 2000,
    onProgress: (s) => console.log(`Status: ${s.status}`),
  },
});
```

## Configuration

```ts
interface ScribeSDKConfig {
  /** Base URL of the scribe service (required) */
  baseUrl: string;

  /** Bearer token for authentication */
  accessToken?: string;

  /** Transport mode: 'direct' (HTTP) or 'ipc' (Electron). Default: 'direct' */
  mode?: 'direct' | 'ipc';

  /** IPC bridge — required when mode is 'ipc' */
  ipcTransport?: IpcBridge;

  /** SharedWorker: true (require), false (disable), 'auto' (detect). Default: 'auto' */
  useWorker?: boolean | 'auto';

  /** URL to worker.bundle.js. Use getWorkerUrl() to resolve. */
  workerScriptUrl?: string;

  /** Enable debug logging. Default: false */
  debug?: boolean;

  /** Auto-fetch discovery document on init. Default: true */
  autoDiscovery?: boolean;
}
```

## API Reference

### Lifecycle

| Method | Returns | Description |
|---|---|---|
| `init()` | `SDKResult<void>` | Fetch discovery document. Called automatically by `startRecording`. |
| `reset()` | `Promise<void>` | Stop recording, clear all state and caches. |

### Recording

| Method | Returns | Description |
|---|---|---|
| `startRecording(options)` | `SDKResult<CreateSessionResponse>` | Create session + start mic + begin upload. |
| `startRecordingWithSession(session, options?)` | `SDKResult<void>` | Attach recorder to an existing session. |
| `pauseRecording()` | `void` | Pause VAD (mic stays open, no chunks created). |
| `resumeRecording()` | `void` | Resume VAD processing. |
| `endRecording()` | `SDKResult<StopRecordingResult>` | Stop mic, flush audio, wait for uploads, end session. |
| `isRecording()` | `boolean` | Whether a recording is active. |
| `isRecordingPaused()` | `boolean` | Whether the active recording is paused. |
| `retryFailedUploads()` | `SDKResult<RetryUploadResult>` | Retry uploads that failed during the last recording. |
| `hasFailedUploads()` | `boolean` | Whether there are retryable failed uploads. |

#### Recording Options

```ts
interface RecordingOptions {
  templates: string[];          // Template IDs for extraction (required)
  model?: string;               // Model ID from discovery
  languageHint?: string[];      // Language codes for audio input
  transcriptLanguage?: string[];// Language codes for transcript output
  uploadType?: string;          // 'chunked' | 'single' (default: 'chunked')
  communicationProtocol?: string;// 'http' | 'websocket' (default: 'http')
  additionalData?: Record<string, any>;
  deviceId?: string;            // Specific microphone device ID
}
```

### Session

| Method | Returns | Description |
|---|---|---|
| `createSession(request)` | `SDKResult<CreateSessionResponse>` | Create a session without starting a recording. |
| `getSessionStatus(sessionId?, options?)` | `SDKResult<GetSessionStatusResponse>` | Get status. Pass `{ poll: PollOptions }` to poll until completion. |
| `getCurrentSession()` | `CreateSessionResponse \| null` | Get the active session if any. |

#### Polling

Pass `poll` options to `getSessionStatus` to poll until the session reaches a terminal state:

```ts
const result = await client.getSessionStatus(sessionId, {
  poll: {
    maxAttempts: 60,
    intervalMs: 2000,
    onProgress: (status) => console.log(status.status),
  },
});
```

### Discovery

| Method | Returns | Description |
|---|---|---|
| `getDiscoveryDocument()` | `DiscoveryDocument \| null` | Raw discovery document. |
| `getDiscoveryConfig()` | `SDKResult<ResolvedConfig>` | Resolved config from discovery. |
| `refreshDiscovery()` | `SDKResult<ResolvedConfig>` | Force-refresh discovery. |

### Auth

| Method | Description |
|---|---|
| `setAccessToken(token)` | Update Bearer token. Propagates to transport, recorder, and worker. |

### Callbacks

Register with `client.registerCallback(name, handler)`, remove with `client.removeCallback(name, handler)`.

| Callback | Payload | Description |
|---|---|---|
| `onRecordingStateChange` | `RecordingStateChangeEvent` | Recording started, paused, resumed, or ended. |
| `onAudioEvent` | `AudioEvent` | Speech detection, silence warnings, chunk ready. |
| `onUploadEvent` | `UploadEvent` | Upload progress and failures. |
| `onSessionEvent` | `SessionEvent` | Session created, ended, status updates. |
| `onError` | `ErrorEvent` | VAD, worker, transport, or validation errors. |
| `onTokenRequired` | `TokenRequiredEvent` | 401 received — call `event.resolve(newToken)` to retry. |

## Error Handling

All public async methods return `SDKResult<T>` — errors are returned, not thrown:

```ts
type SDKResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScribeError };
```

```ts
const result = await client.startRecording({ templates: ['soap'] });

if (!result.success) {
  console.error(result.error.code, result.error.message);
  return;
}

// result.data is typed as CreateSessionResponse
console.log(result.data.session_id);
```

### Error Classes

| Error | HTTP | Description |
|---|---|---|
| `ScribeError` | — | Base error class |
| `ValidationError` | 400 | Invalid request or config |
| `AuthenticationError` | 401 | Auth failed (after token refresh attempt) |
| `ForbiddenError` | 403 | Access denied |
| `SessionNotFoundError` | 404 | Session doesn't exist |
| `SessionExpiredError` | 410 | Session expired |
| `RateLimitError` | 429 | Rate limit exceeded |
| `DiscoveryError` | — | Discovery fetch/parse failed |
| `TransportError` | — | Network / IPC failure |
| `WorkerError` | — | SharedWorker failure |
| `UploadError` | — | Audio upload failure |

### Auto Token Refresh

When a 401 is received, the SDK dispatches `onTokenRequired`. Supply a new token to retry the request:

```ts
client.registerCallback('onTokenRequired', async (event) => {
  const newToken = await refreshMyAuthToken();
  event.resolve(newToken);
});
```

Concurrent 401s are deduplicated — only one callback fires regardless of how many requests failed simultaneously.

## SharedWorker Support

The SDK offloads MP3 compression and upload to a SharedWorker for better main-thread performance. The worker is bundled separately as `dist/worker.bundle.js`.

### Setup

```ts
import { ScribeClient, getWorkerUrl } from 'med-scribe-alliance-ts-sdk';

const client = new ScribeClient({
  baseUrl: 'https://api.example.com',
  workerScriptUrl: getWorkerUrl(), // or a custom path
});
```

### Serving the Worker

The worker file must be served as a static asset:

**Copy to your public directory:**
```bash
cp node_modules/med-scribe-alliance-ts-sdk/dist/worker.bundle.js public/
```

**Or use a CDN blob URL (avoids same-origin restrictions):**
```ts
import { createWorkerBlobUrl } from 'med-scribe-alliance-ts-sdk';

const workerUrl = await createWorkerBlobUrl();
const client = new ScribeClient({
  baseUrl: '...',
  workerScriptUrl: workerUrl,
});
```

**Or set a global override:**
```ts
window.__MEDSCRIBE_WORKER_URL__ = '/assets/worker.bundle.js';
```

If the SharedWorker fails to initialize, the SDK silently falls back to main-thread compression and upload.

## Electron / IPC Mode

For Electron apps where network requests must go through the main process:

```ts
import { ScribeClient, TransportMode } from 'med-scribe-alliance-ts-sdk';

const client = new ScribeClient({
  baseUrl: 'https://api.example.com',
  mode: TransportMode.IPC,
  ipcTransport: {
    send: (request) => ipcRenderer.send('scribe-request', request),
    onResponse: (handler) => ipcRenderer.on('scribe-response', (_, res) => handler(res)),
  },
});
```

IPC mode always uses main-thread compression (SharedWorker can't access the IPC bridge).

## Two-Step Flow

For apps that need to create the session separately from recording:

```ts
// Step 1: Create session
const session = await client.createSession({
  templates: ['soap'],
  upload_type: 'chunked',
  communication_protocol: 'http',
});

if (!session.success) return;

// Step 2: Start recording with the existing session
await client.startRecordingWithSession(session.data, {
  uploadType: 'chunked',
});
```

## Building from Source

```bash
npm install
npm run build
```

Build output (`dist/`):

| File | Description |
|---|---|
| `index.mjs` | Minified ESM bundle |
| `index.d.ts` | Bundled type declarations |
| `worker.bundle.js` | Self-contained IIFE SharedWorker |

## License

MIT
