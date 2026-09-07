# MedScribe Alliance TS SDK

TypeScript SDK for the [MedScribe Alliance Protocol](https://github.com/MedScribeAlliance/scribe-emr-protocol) — handles discovery, recording, audio chunking (VAD), MP3 compression, upload, session lifecycle, and output retrieval.

## npm package link

https://www.npmjs.com/package/med-scribe-alliance-ts-sdk

## Installation

```bash
npm install med-scribe-alliance-ts-sdk
```

Peer dependencies (installed automatically):

- `@ricky0123/vad-web` — Voice Activity Detection
- `@breezystack/lamejs` — MP3 encoding
- `zod` — Schema validation

---

## Integration Guide (Step-by-Step)

### Step 1: Create the Client

The `baseUrl` is **required** — all API calls (session creation, upload, status polling) go through this URL.

```ts
import { ScribeClient } from 'med-scribe-alliance-ts-sdk';

const client = new ScribeClient({
  baseUrl: 'https://api.eka.care/voice/api/v2', // your scribe service URL
  accessToken: 'your-bearer-token',
  debug: true, // optional: logs SDK activity to console
});
```

### Step 2: Initialize (Discovery)

`init()` fetches the discovery document from the server. This tells the SDK what the server supports (models, languages, upload methods, audio formats, etc.).

```ts
const initResult = await client.init();
if (!initResult.success) {
  console.error('Init failed:', initResult.error.message);
  return;
}
```

> `startRecording()` calls `init()` automatically if not already initialized. You can skip this step if you go directly to recording.

### Step 3: Register Callbacks

Register callbacks **before** starting a recording. These are how you receive events from the SDK.

```ts
// Upload progress
client.registerCallback('onUploadEvent', (event) => {
  if (event.type === 'progress') {
    console.log(`Uploaded ${event.data.successCount}/${event.data.totalCount}`);
  }
});

// Recording state changes
client.registerCallback('onRecordingStateChange', (event) => {
  console.log('Recording state:', event.type); // 'started' | 'paused' | 'resumed' | 'ended'
});

// Errors (VAD failures, network issues, validation)
client.registerCallback('onError', (event) => {
  console.error(`[${event.error.code}] ${event.error.message}`);
});

// Auto token refresh on 401
client.registerCallback('onTokenRequired', async (event) => {
  const newToken = await refreshMyAuthToken();
  event.resolve(newToken);
});
```

### Step 4: Start Recording

Creates a session, starts the microphone, and begins chunked upload in one call.

```ts
const result = await client.startRecording({
  templates: ['soap'],           // required: template IDs for extraction
  uploadType: 'chunked',         // 'chunked' (default) | 'single' | 'stream'
  sessionMode: 'consultation',   // optional: 'consultation' | 'dictation'
  transcriptLanguage: 'en',      // optional: language code for transcript output
  languageHint: ['en', 'hi'],    // optional: language codes for audio input
  patientDetails: {              // optional
    name: 'John Doe',
    age: '45',
    gender: 'male',
  },
  additionalData: {},            // optional: any extra data for the session
  txnId: 'your-transaction-id',  // optional: external transaction ID
});

if (!result.success) {
  console.error('Failed to start:', result.error.message);
  return;
}

const sessionId = result.data.session_id;
```

#### Pause / Resume

```ts
client.pauseRecording();  // pauses VAD — mic stays open, no new chunks created
client.resumeRecording(); // resumes VAD processing
```

### Step 5: End Recording

Stops the microphone, flushes the last audio chunk, waits for all uploads to complete, and tells the server the session has ended (triggers server-side processing).

```ts
const stopResult = await client.endRecording();

if (stopResult.success) {
  console.log(`${stopResult.data.totalFiles} files uploaded`);
  console.log(`${stopResult.data.failedUploads.length} failed`);
}
```

### Step 6: Poll for Results

After ending the recording, poll the server until processing is complete.

```ts
const abortController = new AbortController();

const status = await client.getSessionStatus(sessionId, {
  poll: {
    maxAttempts: 60,
    intervalMs: 2000,
    signal: abortController.signal, // optional: abort polling early
    onProgress: (s) => {
      console.log(`Status: ${s.status}`);
      if (s.templates) {
        console.log('Templates:', s.templates);
      }
    },
  },
});

if (status.success) {
  console.log('Final status:', status.data.status);
  console.log('Templates:', status.data.templates);
  console.log('Transcript:', status.data.transcript);
}
```

### Step 7: Clean Up

```ts
await client.reset(); // stops recording if active, clears all state and caches
```

### Flow Diagram

```
  new ScribeClient({ baseUrl, accessToken })
         │
         ▼
      init()  ──────────  Fetches discovery (auto-called by startRecording)
         │
         ▼
  registerCallback()  ──  Set up event handlers before recording
         │
         ▼
  startRecording()  ────  Creates session → starts mic → begins upload
         │
    pause / resume  ────  Optional during recording
         │
         ▼
  endRecording()  ──────  Stops mic → flushes audio → ends session → triggers processing
         │
         ▼
  getSessionStatus()  ──  Poll until completed/failed
         │
         ▼
  Read results  ────────  templates, transcript, errors
```

---

## Important Notes

- **`baseUrl` is the root for all API calls.** Session creation, audio upload, status polling — everything uses this URL. Make sure it's correct and accessible.
- **`accessToken` must be a valid Bearer token.** All API requests include `Authorization: Bearer <token>`. If it expires, register `onTokenRequired` to auto-refresh.
- **Register callbacks before `startRecording()`.** Events fire immediately once recording starts — if callbacks aren't registered, you'll miss upload progress and errors.
- **`endRecording()` triggers server processing.** Once you call it, the server begins processing the uploaded audio. Use `cancelSession()` instead if you don't want processing to happen.
- **`cancelSession()` does NOT trigger processing.** It stops the recorder locally, cleans up state, and tells the server the session is cancelled. No `endSession` call is made to the backend.
- **All async methods return `SDKResult<T>`, never throw.** Always check `result.success` before accessing `result.data`. Errors are in `result.error`.
- **The SDK validates inputs against the discovery document.** If the server doesn't support an upload type, language, or model you requested, you'll get a `ValidationError` before the API call is made.
- **Audio uploads go to a server-selected storage backend.** Discovery's `capabilities.storage_provider` (default `aws`) decides the backend; uploads go directly to it (e.g. S3 presigned POST). 

- **SharedWorker is optional.** If you provide `workerScriptUrl`, the SDK offloads MP3 compression and upload to a SharedWorker. If the worker fails to load, it silently falls back to main-thread processing.
- **Microphone permission is requested on `startRecording()`.** The browser will prompt the user for mic access. If denied, you'll get an error via `onError` callback.
- **`reset()` is a full teardown.** It destroys the transport, clears discovery cache, removes all callbacks, and sets the client back to uninitialized state. You'll need to call `init()` (or `startRecording()`) again after reset.
- **Polling supports `AbortSignal`.** Pass `signal` in poll options to cancel polling early (e.g. when the user navigates away).

---

## Other Operations

### Cancel a Session

Stops the recorder locally **without** triggering server-side processing, then tells the server the session is cancelled.

```ts
await client.cancelSession(); // cancels the current active session
await client.cancelSession('specific-session-id'); // or by ID
```

### Update a Session (Patch)

Update session properties after creation.

```ts
await client.updateSession({
  patient_details: { name: 'Jane Doe', age: '30', gender: 'female' },
  additional_data: { notes: 'Follow-up visit' },
  templates: ['soap', 'prescription'],
});
```

### Process a Specific Template

Trigger server-side processing for a specific template.

```ts
await client.processTemplate('soap');
await client.processTemplate('soap', 'session-id'); // with explicit session ID
```

### Two-Step Flow (Create Session + Record Separately)

```ts
// Step 1: Create session
const session = await client.createSession({
  templates: ['soap'],
  upload_type: 'chunked',
  communication_protocol: 'http',
  session_mode: 'consultation',
});

if (!session.success) return;

// Step 2: Start recording with the existing session
await client.startRecordingWithSession(session.data, {
  uploadType: 'chunked',
});
```

### Get Status for a Specific Template

```ts
const status = await client.getSessionStatus(sessionId, {
  templateId: 'soap',
});
```

### Retry Failed Uploads

```ts
if (client.hasFailedUploads()) {
  const retryResult = await client.retryFailedUploads();
  console.log(`Retried: ${retryResult.data.retried}, Succeeded: ${retryResult.data.succeeded}`);
}
```

### Upload a Pre-recorded Audio File

For processing an already-recorded file (no mic/VAD). Create a session, then upload the file using the session's `upload_url`, then end the session and poll.

```ts
// 1. Create a session (gives you upload_url)
const session = await client.createSession({
  templates: ['soap'],
  upload_type: 'single',
  communication_protocol: 'http',
});
if (!session.success) return;

// 2. Upload the file to storage using the session's upload_url
const upload = await client.uploadAudioFile(
  myAudioFile,
  '1.mp3',                  // storage object name
  session.data.upload_url
);
if (!upload.success) {
  console.error('Upload failed:', upload.error.message);
  return;
}
console.log(upload.data.status, upload.data.headers); // full storage response

// 3. End the session to trigger processing, then poll getSessionStatus()
await client.endSession(
  { audio_files_sent: 1, audio_files_uploaded: 1 },
  session.data.session_id
);
```

- `file` is a `File`/`Blob`; `fileName` is the storage object name; `upload` is the `upload_url` object from the create-session response.
- Returns `UploadAudioFileResult` — `{ fileName, status, headers, response }` (the full storage response; the body is usually empty for an S3 presigned POST).
- Failures (network, malformed `upload_url`) come back as `UploadError` in `result.error`; an unknown provider as `UnsupportedStorageProviderError`.

### Update Auth Token

```ts
client.setAccessToken('new-bearer-token');
```

---

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

## Recording Options

```ts
interface RecordingOptions {
  templates: string[];                   // Template IDs for extraction (required)
  model?: string;                        // Model ID from discovery
  languageHint?: string[];               // Language codes for audio input
  transcriptLanguage?: string;           // Language code for transcript output
  uploadType?: string;                   // 'chunked' | 'single' | 'stream' (default: 'chunked')
  communicationProtocol?: string;        // 'http' | 'websocket' (default: 'http')
  additionalData?: Record<string, any>;  // Extra data for the session
  deviceId?: string;                     // Specific microphone device ID
  sessionMode?: string;                  // 'consultation' | 'dictation'
  patientDetails?: PatientDetails;       // Patient info
  version?: string;                      // Optional API version (sent as a `version` query param on create-session)
  txnId?: string;                        // External transaction ID
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
| `startRecordingWithSession(session, options?)` | `SDKResult<void>` | Attach recorder to an existing session. `options.version` (the version the session was created with) is reused when refreshing `upload_url` on upload failure. |
| `pauseRecording()` | `void` | Pause VAD (mic stays open, no chunks created). |
| `resumeRecording()` | `void` | Resume VAD processing. |
| `endRecording()` | `SDKResult<StopRecordingResult>` | Stop mic, flush audio, wait for uploads, end session. |
| `isRecording()` | `boolean` | Whether a recording is active. |
| `isRecordingPaused()` | `boolean` | Whether the active recording is paused. |
| `retryFailedUploads()` | `SDKResult<RetryUploadResult>` | Retry uploads that failed during the last recording. |
| `hasFailedUploads()` | `boolean` | Whether there are retryable failed uploads. |
| `uploadAudioFile(file, fileName, upload)` | `SDKResult<UploadAudioFileResult>` | Upload one pre-recorded audio file to storage using a session's `upload_url`. No mic/recorder. |

### Session

| Method | Returns | Description |
|---|---|---|
| `createSession(request, version?)` | `SDKResult<CreateSessionResponse>` | Create a session without starting a recording. Optional `version` is sent as a `version` query param. |
| `getSessionStatus(sessionId?, options?)` | `SDKResult<GetSessionStatusResponse>` | Get status. Supports `poll`, `templateId`, and `version` options (`version` sent as a query param). |
| `getCurrentSession()` | `CreateSessionResponse \| null` | Get the active session if any. |
| `updateSession(request, sessionId?)` | `SDKResult<PatchSessionResponse>` | Patch session (patient details, status, etc.). |
| `processTemplate(templateId, sessionId?)` | `SDKResult<ProcessTemplateResponse>` | Trigger processing for a specific template. |
| `cancelSession(sessionId?)` | `SDKResult<PatchSessionResponse>` | Cancel session (stops recorder, no server processing). |

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

#### Payload Shapes

```ts
// onRecordingStateChange
interface RecordingStateChangeEvent {
  type: 'started' | 'paused' | 'resumed' | 'ended';
  timestamp: string;
  data?: any;
}

// onAudioEvent — discriminated union by `type`
type AudioEvent =
  | { type: 'user_speech';      timestamp: string; data: { isSpeaking: boolean } }
  | { type: 'silence_warning';  timestamp: string; data: { durationMs: number } }
  | { type: 'chunk_ready';      timestamp: string; data: { chunkIndex: number; fileName: string; chunkData: Uint8Array[] } }
  | { type: 'frame_processed';  timestamp: string; data: { isSpeech: number; notSpeech: number; frame: Float32Array; duration: number } };

// onUploadEvent
type UploadEvent =
  | { type: 'progress'; timestamp: string; data: { successCount: number; totalCount: number } }
  | { type: 'failed';   timestamp: string; data: { fileName: string; error: string } }
  | { type: 'retry';    timestamp: string; data: { fileName: string; attempt: number } };

// onSessionEvent
type SessionEvent =
  | { type: 'created';        timestamp: string; data: CreateSessionResponse }
  | { type: 'ended';          timestamp: string; data: EndSessionResponse }
  | { type: 'discarded';      timestamp: string; data: { sessionId: string | null; reason: 'cleared' | 'cancelled' | 'reset' } }
  | { type: 'status_update';  timestamp: string; data: GetSessionStatusResponse }
  | { type: 'partial_result'; timestamp: string; data: any };

// onError
interface ErrorEvent {
  type: 'vad_error' | 'worker_error' | 'transport_error' | 'validation_error';
  timestamp: string;
  error: { code: string; message: string; details?: any };
}

// onTokenRequired — call event.resolve(newToken) to retry the failed request
interface TokenRequiredEvent {
  resolve: (newToken: string) => void;
}
```

## Request / Response Types

#### Session

```ts
interface CreateSessionRequest {
  templates: string[];
  upload_type: string;                   // 'chunked' | 'single' | 'stream'
  communication_protocol: string;        // 'http' | 'websocket'
  model?: string;
  language_hint?: string[];
  transcript_language?: string;
  additional_data?: Record<string, any>;
  session_mode?: string;                 // 'consultation' | 'dictation'
  patient_details?: PatientDetails;
  session_id?: string;                   // optional client-supplied ID
}

interface CreateSessionResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  upload_url: SessionUploadInfo;
  patient_details?: PatientDetails;
}

type SessionUploadInfo = Record<string, unknown>;

interface PatchSessionRequest {
  user_status?: string;
  processing_status?: string;
  patient_details?: PatientDetails;
  additional_data?: Record<string, any>;
  language_hint?: string[];
  transcript_language?: string;
  templates?: string[];
}

interface PatchSessionResponse {
  session_id: string;
  status: string;
  message: string;
}

interface EndSessionResponse {
  session_id: string;
  status: SessionStatus;
  message: string;
  audio_files_received: number;
  audio_files: string[];
}

interface GetSessionStatusResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at?: string | null;
  expired_at?: string | null;
  completed_at?: string | null;
  model_used?: string | null;
  language_detected?: string | null;
  audio_files_received: number;
  audio_files: string[];
  audio_files_processed?: number;
  additional_data: Record<string, any>;
  templates?: TemplateEntry[];           // { [templateId]: { status, data, fhir, error, ... } }
  transcript?: string;
  processing_errors?: ProcessingError[];
  error?: { code: string; message: string; details?: Record<string, any> };
  patient_details?: PatientDetails;
  message?: string;
}

interface ProcessTemplateResponse {
  session_id: string;
  template_id: string;
  status: string;
  message: string;
}

interface PatientDetails {
  oid?: string;
  name?: string;
  age?: string;
  gender?: string;
  mobile?: number;
}
```

#### Recording

```ts
interface StopRecordingResult {
  failedUploads: string[];
  totalFiles: number;
}

interface EndRecordingResult extends StopRecordingResult {
  sessionEnded: boolean;
  endSessionResponse?: EndSessionResponse;
}

interface RetryUploadResult {
  retried: number;
  succeeded: number;
  stillFailed: string[];
}

interface PollOptions {
  maxAttempts?: number;
  intervalMs?: number;
  onProgress?: (status: GetSessionStatusResponse) => void;
  signal?: AbortSignal;
}
```

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
| `UploadError` | — | Audio upload failure (failed transfer, or malformed `upload_url` payload). Has `failedFiles: string[]`. |
| `UnsupportedStorageProviderError` | — | Discovery advertised a `storage_provider` this SDK build has no wrapper for. Thrown at `startRecording`. Has `provider: string`. |

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

> **Presigned uploads over IPC need host support.** The SDK forwards `uploadFormFields` + base64 file (`blobData`) in the `IpcRequest`; your host must build the `multipart/form-data` POST (no `Authorization` header). Browser/HTTP mode works out of the box.

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
