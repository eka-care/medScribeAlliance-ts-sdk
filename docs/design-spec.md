# MedScribe Alliance TS SDK - Design Specification

**Date:** 2026-05-08
**Version:** 2.0.0 (Architecture Revamp)
**Status:** Draft

---

## 1. Purpose

Revamp the MedScribe Alliance TS SDK to be a self-contained, protocol-compliant SDK that handles:

1. Service discovery and capability resolution
2. Audio recording (VAD-based chunked and single-file modes)
3. Audio compression (MP3 via lamejs, offloaded to SharedWorker when available)
4. Audio upload via pluggable transport (HTTP or Electron IPC)
5. Session lifecycle management
6. Output retrieval (polling and direct query)

The SDK becomes the single source of truth for recording in the Eka ecosystem. The eka-js-sdk will become a thin wrapper that delegates recording to this SDK.

---

## 2. SDK Initialization

### 2.1 Configuration

```typescript
interface ScribeSDKConfig {
  // Required
  baseUrl: string;

  // Authentication (one required)
  apiKey?: string;
  accessToken?: string;

  // Transport mode
  mode?: 'direct' | 'ipc';               // default: 'direct'
  ipcTransport?: {                        // required when mode is 'ipc'
    send: (request: IpcRequest) => void;
    onResponse: (handler: (response: IpcResponse) => void) => void;
  };

  // Worker configuration
  useWorker?: true | false | 'auto';      // default: 'auto'

  // Optional
  debug?: boolean;                        // default: false
  autoDiscovery?: boolean;                // default: true
}
```

### 2.2 Initialization Flow

```
Consumer calls ScribeClient.getInstance(config)
    |
    v
Validate config (baseUrl required, auth present, ipc config if mode='ipc')
    |
    v
Create transport (HttpTransport or IpcTransport based on mode)
    |
    v
Consumer calls client.init()
    |
    v
DiscoveryManager.fetchDiscovery(baseUrl)
    |
    v
Validate discovery response against schema
    |
    v
Parse into ResolvedConfig (runtime constraints)
    |
    v
WorkerManager.initialize(useWorker config)
    |-- 'auto': detect SharedWorker support, spawn if available
    |-- true:   require SharedWorker, throw if unavailable
    |-- false:  skip, use main thread
    |
    v
SDK is ready. ResolvedConfig available to all managers.
```

---

## 3. Recording Lifecycle

### 3.1 Start Recording

```
Consumer calls client.startRecording(options)
    |
    v
Validator: check options against schema
    |
    v
Validator: check options against ResolvedConfig
    |-- uploadType in capabilities.upload_methods?
    |-- languageHint in languages.supported?
    |-- model in models[]?
    |-- audio format in capabilities.audio_formats?
    |
    v (any check fails -> throw ValidationError)
    |
    v
Check microphone permission (navigator.permissions.query)
    |
    v
SessionManager.createSession(request) via transport
    |
    v
Validator: validate CreateSession response
    |
    v
CallbackRegistry.dispatch('onSessionEvent', { type: 'created', data: session })
    |
    v
Initialize recorder based on uploadType:
    |
    |-- 'chunked' --> ChunkedRecorder
    |   |
    |   v
    |   VadClient.init(deviceId)
    |   |-- Get mic stream
    |   |-- Create MicVAD instance
    |   |-- Set up frame processing pipeline
    |   |-- Configure chunk lengths from ResolvedConfig
    |   |       (capabilities.max_chunk_duration_seconds)
    |   v
    |   VadClient.start()
    |   |
    |   v
    |   CallbackRegistry.dispatch('onRecordingStateChange', { type: 'started' })
    |
    |-- 'single' --> SingleRecorder
        |
        v
        Get mic stream via getUserMedia
        |
        v
        Create MediaRecorder, start recording
        |
        v
        CallbackRegistry.dispatch('onRecordingStateChange', { type: 'started' })
```

### 3.2 Chunked Recording - Frame Processing Pipeline

```
MicVAD.onFrameProcessed(probabilities, frame)
    |
    v
AudioFileManager.incrementRawSamples(frame)   // track total raw samples
    |
    v
AudioBufferManager.append(frame)               // accumulate in buffer
    |
    v
CallbackRegistry.dispatch('onAudioEvent', {
  type: 'frame_processed',
  data: { isSpeech, notSpeech }
})
    |
    v
VadClient.processVadFrame(vad_decision)
    |
    v
Is clip point?
    |
    |-- NO --> continue
    |
    |-- YES -->
        |
        v
    audioFrames = AudioBufferManager.getAudioData()
        |
        v
    Build chunk metadata (fileName, timestamps)
        |
        v
    AudioFileManager.updateAudioInfo(chunkInfo)
        |
        v
    AudioBufferManager.resetBufferState()
        |
        v
    CallbackRegistry.dispatch('onAudioEvent', {
      type: 'chunk_ready',
      data: { chunkIndex, fileName }
    })
        |
        v
    WorkerManager.processChunk(audioFrames, fileName, chunkIndex)
        |
        |-- SharedWorker available:
        |     Send Float32Array to worker
        |     Worker: Mp3Encoder.encode() -> transport.upload()
        |     Worker: postMessage back with result
        |
        |-- Main thread fallback:
              Mp3Encoder.encode(audioFrames)
              transport.upload(mp3Blob, uploadUrl, fileName)
        |
        v
    On upload result:
        |
        |-- Success:
        |   AudioFileManager.markSuccess(chunkIndex)
        |   CallbackRegistry.dispatch('onUploadEvent', {
        |     type: 'progress',
        |     data: { successCount, totalCount }
        |   })
        |
        |-- Failure:
            AudioFileManager.markFailure(chunkIndex, blob)
            CallbackRegistry.dispatch('onUploadEvent', {
              type: 'failed',
              data: { fileName, error }
            })
```

### 3.3 Pause Recording

```
Consumer calls client.pauseRecording()
    |
    v
RecordingManager.pause()
    |
    |-- Chunked: VadClient.pause() (stops mic processing, buffer stays intact)
    |-- Single:  MediaRecorder.pause()
    |
    v
CallbackRegistry.dispatch('onRecordingStateChange', { type: 'paused' })
```

### 3.4 Resume Recording

```
Consumer calls client.resumeRecording()
    |
    v
RecordingManager.resume()
    |
    |-- Chunked: VadClient.start() (resumes, buffer continues from where it was)
    |-- Single:  MediaRecorder.resume()
    |
    v
CallbackRegistry.dispatch('onRecordingStateChange', { type: 'resumed' })
```

### 3.5 End Recording

```
Consumer calls client.endRecording()
    |
    v
RecordingManager.stop()
    |
    |-- Chunked path:
    |   |
    |   v
    |   VadClient.pause() + VadClient.destroy()
    |   |
    |   v
    |   AudioBufferManager has remaining samples?
    |   |
    |   |-- YES: flush last chunk
    |   |   Build metadata, send to WorkerManager for compress + upload
    |   |
    |   |-- NO: skip
    |   |
    |   v
    |   WorkerManager.waitForAllUploads()
    |   |
    |   v
    |   Any failed uploads?
    |   |
    |   |-- YES: retry once
    |   |   |
    |   |   v
    |   |   Still failed after retry?
    |   |   |-- YES: throw ScribeError('upload_failed', failedFiles)
    |   |   |-- NO:  continue
    |   |
    |   v
    |   VadClient.reset()
    |
    |-- Single path:
    |   |
    |   v
    |   MediaRecorder.stop()
    |   |
    |   v
    |   Collect audio blob
    |   |
    |   v
    |   Compress + upload via WorkerManager (or main thread)
    |   |
    |   v
    |   On failure: throw ScribeError('upload_failed')
    |
    v
SessionManager.endSession(sessionId, audioFilesSent)
    |
    v
Validator: validate EndSession response
    |
    v
CallbackRegistry.dispatch('onSessionEvent', { type: 'ended', data: response })
CallbackRegistry.dispatch('onRecordingStateChange', { type: 'ended' })
    |
    v
Return EndSessionResponse
```

---

## 4. Transport Layer

### 4.1 Interface

```typescript
interface TransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  isUpload?: boolean;           // true for audio upload calls
  uploadBlob?: Blob;            // raw blob for upload calls
}

interface TransportResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

interface ITransport {
  request<T>(config: TransportRequest): Promise<TransportResponse<T>>;
  setAuthToken(token: string): void;
}
```

### 4.2 HttpTransport

- Uses `fetch()` directly
- Adds auth headers (API key or Bearer token)
- For uploads: sends blob with `Content-Type: audio/mp3`
- Retry logic: 3 attempts, 2s delay, skip retry on 4xx (except 408, 429)

### 4.3 IpcTransport

- Serializes `TransportRequest` and sends via consumer-provided `ipcTransport.send()`
- Listens for response via `ipcTransport.onResponse()`
- Matches request/response via correlation ID
- For uploads: serializes blob to ArrayBuffer before sending over IPC
- Same retry logic as HttpTransport (retries happen on SDK side, not host side)

### 4.4 Token Refresh Flow

```
Transport receives 401 response
    |
    v
CallbackRegistry.dispatch('onTokenRequired', {
  resolve: (newToken: string) => void
})
    |
    v
Consumer provides new token
    |
    v
transport.setAuthToken(newToken)
    |
    v
Retry the failed request with new token
    |
    |-- Success: return response
    |-- Failure: throw AuthenticationError
```

---

## 5. SharedWorker

### 5.1 Worker Manager (main thread)

```
WorkerManager.initialize(config)
    |
    v
config.useWorker === 'auto'?
    |
    |-- Check: typeof SharedWorker !== 'undefined'
    |   |
    |   |-- YES: spawn SharedWorker, set workerAvailable = true
    |   |-- NO:  workerAvailable = false, use main thread
    |
config.useWorker === true?
    |-- Check SharedWorker support
    |   |-- NO: throw Error('SharedWorker not supported')
    |   |-- YES: spawn worker
    |
config.useWorker === false?
    |-- workerAvailable = false
```

### 5.2 Worker Script (shared-worker.ts)

Runs in a separate thread. Handles:

1. Receives raw `Float32Array` audio frames from main thread
2. Compresses to MP3 using `Mp3Encoder`
3. Uploads via HTTP (worker has its own fetch context)
4. Reports success/failure back to main thread

Message protocol:

```typescript
// Main -> Worker
{ type: 'compress_and_upload', audioFrames: Float32Array, fileName: string, uploadUrl: string, headers: Record<string, string> }
{ type: 'wait_for_all_uploads' }
{ type: 'update_auth_token', token: string }
{ type: 'terminate' }

// Worker -> Main
{ type: 'upload_success', fileName: string }
{ type: 'upload_failed', fileName: string, error: string }
{ type: 'all_uploads_complete' }
```

### 5.3 Main Thread Fallback

When SharedWorker is unavailable, `WorkerManager` falls back to synchronous processing:

```typescript
async processChunk(audioFrames, fileName, uploadUrl, headers) {
  if (this.workerAvailable) {
    this.worker.postMessage({ type: 'compress_and_upload', ... });
  } else {
    const mp3Data = Mp3Encoder.encode(audioFrames);
    const blob = new Blob(mp3Data, { type: 'audio/mpeg' });
    await this.transport.request({ method: 'POST', url, uploadBlob: blob });
  }
}
```

---

## 6. Discovery & Validation

### 6.1 Discovery Manager

```typescript
class DiscoveryManager {
  // Fetch and cache
  async fetchDiscovery(baseUrl: string): Promise<DiscoveryDocument>;
  clearCache(): void;

  // Raw document access
  getDiscoveryDocument(): DiscoveryDocument | null;

  // Convenience getters (read from ResolvedConfig)
  getSupportedLanguages(): string[];
  getSupportedAudioFormats(): string[];
  getSupportedUploadMethods(): UploadType[];
  getAvailableModels(): ModelConfig[];
  getMaxChunkDuration(): number;
  getMaxSessionDuration(modelId?: string): number;
  getServiceInfo(): ServiceInfo;
  getCapabilities(): CapabilitiesInfo;
  isFeatureSupported(feature: string): boolean;
}
```

### 6.2 ResolvedConfig

Parsed from discovery document. Used by all layers at runtime:

```typescript
interface ResolvedConfig {
  baseUrl: string;
  webhooksUrl?: string;
  supportedLanguages: string[];
  autoDetectLanguage: boolean;
  supportedAudioFormats: string[];
  supportedUploadMethods: UploadType[];
  maxChunkDurationSeconds: number;
  maxSessionDurationSeconds: Map<string, number>;  // modelId -> duration
  supportedAuthMethods: string[];
  availableModels: ModelConfig[];
  webhookDelivery: boolean;
  clientSdkDelivery: boolean;
}
```

### 6.3 Validation Rules

**Request validation (schema):**

| API Call | Validations |
|---|---|
| CreateSession | templates required (array, max 2), upload_type required (valid enum), communication_protocol required (valid enum), language_hint (array of 2-char strings), model (valid enum) |
| EndSession | session_id format (ses_[alphanumeric]) |
| GetSessionStatus | session_id format |
| StartRecording | all CreateSession validations + deviceId optional string |

**Response validation (schema):**

| API Response | Validations |
|---|---|
| Discovery | protocol, protocol_version, endpoints.base_url, capabilities required. audio_formats non-empty. |
| CreateSession | session_id, status, upload_url required |
| EndSession | session_id, status, message required |
| GetSessionStatus | session_id, status required |

**Discovery-driven validation (capabilities):**

| Check | Error if violated |
|---|---|
| `options.uploadType` in `capabilities.upload_methods` | "Upload type '{type}' not supported. Server supports: {list}" |
| `options.languageHint` items in `languages.supported` | "Language '{lang}' not supported. Server supports: {list}" |
| `options.model` in `models[].id` | "Model '{model}' not available. Available: {list}" |
| chunk duration <= `capabilities.max_chunk_duration_seconds` | SDK auto-configures, no consumer error |
| `options.audioFormat` in `capabilities.audio_formats` | "Audio format '{fmt}' not supported. Server supports: {list}" |

---

## 7. Callback System

### 7.1 Callback Types

```typescript
// -- Recording State --
type RecordingState = 'started' | 'paused' | 'resumed' | 'ended';

interface RecordingStateChangeEvent {
  type: RecordingState;
  timestamp: string;
  data?: any;
}

// -- Audio Events --
type AudioEventType = 'user_speech' | 'silence_warning' | 'chunk_ready' | 'frame_processed';

interface AudioEvent {
  type: AudioEventType;
  timestamp: string;
  data:
    | { isSpeaking: boolean }                              // user_speech
    | { durationMs: number }                               // silence_warning
    | { chunkIndex: number; fileName: string }             // chunk_ready
    | { isSpeech: number; notSpeech: number }              // frame_processed
}

// -- Upload Events --
type UploadEventType = 'progress' | 'failed' | 'retry';

interface UploadEvent {
  type: UploadEventType;
  timestamp: string;
  data:
    | { successCount: number; totalCount: number }         // progress
    | { fileName: string; error: string }                  // failed
    | { fileName: string; attempt: number }                // retry
}

// -- Session Events --
type SessionEventType = 'created' | 'ended' | 'status_update' | 'partial_result';

interface SessionEvent {
  type: SessionEventType;
  timestamp: string;
  data: CreateSessionResponse | EndSessionResponse | GetSessionStatusResponse | any;
}

// -- Errors --
type ErrorEventType = 'vad_error' | 'worker_error' | 'transport_error' | 'validation_error';

interface ErrorEvent {
  type: ErrorEventType;
  timestamp: string;
  error: { code: string; message: string; details?: any };
}

// -- Token Required --
interface TokenRequiredEvent {
  resolve: (newToken: string) => void;
}
```

### 7.2 Registration

```typescript
const client = ScribeClient.getInstance(config);

client.on('onRecordingStateChange', (event: RecordingStateChangeEvent) => { ... });
client.on('onAudioEvent', (event: AudioEvent) => { ... });
client.on('onUploadEvent', (event: UploadEvent) => { ... });
client.on('onSessionEvent', (event: SessionEvent) => { ... });
client.on('onError', (event: ErrorEvent) => { ... });
client.on('onTokenRequired', (event: TokenRequiredEvent) => { ... });
```

---

## 8. Error Handling

### 8.1 Error Classes

```
ScribeError (base)
  +-- ValidationError          # Schema or capability validation failed
  +-- DiscoveryError           # Discovery fetch/parse failed
  +-- AuthenticationError      # 401, token expired
  +-- SessionNotFoundError     # 404 session
  +-- SessionExpiredError      # 410 session
  +-- RateLimitError           # 429
  +-- TransportError           # Network failure, IPC failure
  +-- WorkerError              # SharedWorker spawn/communication failure
  +-- UploadError              # Audio upload failed after retries
```

### 8.2 Error Flow

All errors follow the same path:

1. Error occurs in any layer
2. Layer throws typed error
3. Manager catches, dispatches to `CallbackRegistry.dispatch('onError', ...)`
4. Manager re-throws to consumer (so both callback and try/catch work)

---

## 9. Public API Surface

```typescript
class ScribeClient {
  // --- Lifecycle ---
  static getInstance(config: ScribeSDKConfig): ScribeClient;
  static resetInstance(): void;
  async init(): Promise<void>;
  async reset(): Promise<void>;

  // --- Recording ---
  async startRecording(options: RecordingOptions): Promise<CreateSessionResponse>;
  pauseRecording(): void;
  resumeRecording(): void;
  isRecordingPaused(): boolean;
  async endRecording(): Promise<EndSessionResponse>;

  // --- Session ---
  async getSessionStatus(sessionId?: string): Promise<GetSessionStatusResponse>;
  async pollForCompletion(sessionId?: string, options?: PollOptions): Promise<GetSessionStatusResponse>;
  getCurrentSession(): CreateSessionResponse | null;

  // --- Discovery ---
  getDiscoveryDocument(): DiscoveryDocument | null;
  getSupportedLanguages(): string[];
  getSupportedAudioFormats(): string[];
  getSupportedUploadMethods(): UploadType[];
  getAvailableModels(): ModelConfig[];
  getMaxChunkDuration(): number;
  getMaxSessionDuration(modelId?: string): number;
  getServiceInfo(): ServiceInfo;
  getCapabilities(): CapabilitiesInfo;
  isFeatureSupported(feature: string): boolean;

  // --- Callbacks ---
  on(event: 'onRecordingStateChange', handler: (e: RecordingStateChangeEvent) => void): void;
  on(event: 'onAudioEvent', handler: (e: AudioEvent) => void): void;
  on(event: 'onUploadEvent', handler: (e: UploadEvent) => void): void;
  on(event: 'onSessionEvent', handler: (e: SessionEvent) => void): void;
  on(event: 'onError', handler: (e: ErrorEvent) => void): void;
  on(event: 'onTokenRequired', handler: (e: TokenRequiredEvent) => void): void;
  off(event: string, handler: Function): void;
}
```

---

## 10. Migration from Current SDK

| Current | New | Notes |
|---|---|---|
| `ScribeClient` does everything | `ScribeClient` delegates to managers | Same public API shape, different internals |
| `HttpClient` class | `ITransport` interface + implementations | Breaking change for anyone extending HttpClient |
| `EventEmitter` (generic) | `CallbackRegistry` (typed, grouped) | Breaking change: `client.on('session:created')` -> `client.on('onSessionEvent', ...)` |
| VAD does compress + upload | VAD only detects, worker/main thread compresses + uploads | Internal change, not visible to consumers |
| No IPC support | `mode: 'ipc'` in config | New capability |
| Constants hardcoded | Discovery-driven from well-known | Better protocol compliance |
| `AudioFileManager` does everything | Split: metadata tracking vs compression vs upload | Internal change |

---

## 11. Future Considerations (TODO)

- **VAD health monitoring**: detect stalled frames, auto-reinitialize with gap tracking
- **WebSocket transport**: for real-time streaming when protocol supports it
- **Partial results via SSE/WebSocket**: streaming transcription results
- **Offline recording**: buffer locally, upload when connection restored
- **Multi-tab coordination**: SharedWorker already enables this path
