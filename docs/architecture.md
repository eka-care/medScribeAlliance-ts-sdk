# MedScribe Alliance TS SDK - Architecture

## Overview

The MedScribe Alliance TS SDK is a TypeScript SDK implementing the MedScribe Alliance Protocol for medical scribe services. It handles the complete lifecycle: **discover service capabilities -> start recording -> manage audio (VAD-based chunking or single file) -> upload via HTTP or IPC -> end session -> retrieve output**.

The SDK is protocol-compliant — all behavior is governed by the discovery document (well-known endpoint), and all inputs are validated against the server's declared capabilities.

---

## High-Level Architecture

```
+------------------------------------------------------------------+
|                        Consumer Application                       |
|                    (Extension / Electron / Web)                   |
+-------------------------------|----------------------------------+
                                |
                         Public API calls
                                |
+-------------------------------|----------------------------------+
|                         ScribeClient                              |
|                     (Thin Public Facade)                          |
|                                                                   |
|  Singleton instance. Exposes all public methods.                  |
|  Delegates to internal managers. Owns no business logic.          |
+-----+--------+--------+---------+---------+----------+-----------+
      |        |        |         |         |          |
      v        v        v         v         v          v
+--------+ +-------+ +--------+ +--------+ +------+ +----------+
|Disc.   | |Session| |Record. | |Callback| |Valid.| | Worker   |
|Manager | |Manager| |Manager | |Registry| |      | | Manager  |
+--------+ +-------+ +--------+ +--------+ +------+ +----------+
      |        |        |                      |          |
      |        |        v                      |          |
      |        |   +----------+                |          |
      |        |   |Audio Layer|               |          |
      |        |   | VAD      |                |          |
      |        |   | Buffer   |                |          |
      |        |   | Encoder  |                |          |
      |        |   +----------+                |          |
      |        |        |                      |          |
      v        v        v                      v          v
+------------------------------------------------------------------+
|                       Transport Layer                             |
|                      ITransport interface                         |
|              +----------------+----------------+                  |
|              | HttpTransport  | IpcTransport   |                  |
|              | (fetch-based)  | (Electron IPC) |                  |
|              +----------------+----------------+                  |
+------------------------------------------------------------------+
```

---

## Layer Descriptions

### 1. ScribeClient (Public Facade)

The only class consumers interact with. Singleton pattern. Provides:

- Initialization & configuration
- Recording lifecycle methods (start, pause, resume, stop)
- Session query methods (createSession, endSession, getStatus, pollForCompletion)
- Discovery data access methods
- Callback registration

ScribeClient owns no business logic. Every method delegates to the appropriate manager.

### 2. Discovery Manager

- Fetches the `/.well-known/medscribealliance` document
- Caches it with TTL (1 hour default)
- Parses into a `ResolvedConfig` — a runtime configuration object used by all other layers
- Provides convenience getters for discovery data (languages, models, capabilities, etc.)

### 3. Session Manager

- Manages session lifecycle via protocol API calls
- `createSession()` — POST /sessions
- `endSession()` — POST /sessions/{id}/end
- `getSessionStatus()` — GET /sessions/{id}
- `pollForCompletion()` — polls getSessionStatus until terminal state
- All calls go through the transport layer (never calls fetch directly)
- All requests/responses validated against schema + discovery capabilities

### 4. Recording Manager

- Orchestrates the recording lifecycle
- `start()` — validates options against discovery, creates session via SessionManager, initializes the appropriate recorder (chunked or single), starts capture
- `pause()` — pauses VAD, does NOT flush buffer
- `resume()` — resumes VAD
- `stop()` — stops VAD, flushes remaining buffer, waits for all uploads, ends session
- Owns the IRecorder instance (ChunkedRecorder or SingleRecorder)

### 5. Audio Layer

Four components, each with a single responsibility:

| Component | Responsibility |
|---|---|
| `VadClient` | Voice Activity Detection. Captures mic audio, detects speech boundaries, determines clip points. Does NOT compress or upload. |
| `AudioBufferManager` | Accumulates raw audio frames in a Float32Array. Tracks sample counts, frame counts, timestamps. |
| `AudioFileManager` | Tracks chunk metadata (file names, timestamps, upload status). Does NOT compress or upload directly. |
| `Mp3Encoder` | Pure function. Takes Float32Array, returns MP3 Uint8Array[]. Uses lamejs. |

**Data flow within audio layer:**

```
Microphone
    |
    v
VadClient (AudioWorklet internally)
    |
    |-- onFrameProcessed --> AudioBufferManager.append(frame)
    |                        AudioFileManager.incrementRawSamples(frame)
    |
    |-- onClipPoint -------> AudioBufferManager.getAudioData()
                              |
                              v
                         Raw Float32Array chunk
                              |
                              v
                    WorkerManager (or main thread)
                         Mp3Encoder.encode()
                              |
                              v
                         Transport.upload()
```

### 6. Transport Layer

An `ITransport` interface with two implementations:

```typescript
interface ITransport {
  request<T>(config: TransportRequest): Promise<TransportResponse<T>>;
}
```

- **HttpTransport** — uses `fetch()` directly. Handles auth headers, retries, error mapping.
- **IpcTransport** — routes requests through Electron IPC. Serializes request, sends via `ipcRenderer.invoke()` or `window.postMessage()`, deserializes response. Same interface, different pipe.

The rest of the SDK never knows which transport is in use.

### 7. Worker Manager

Manages optional SharedWorker for offloading MP3 compression + upload:

- Auto-detects SharedWorker support (when config is `'auto'`)
- Spawns worker, sends raw audio frames to it
- Worker compresses to MP3 and uploads via transport
- Falls back to main-thread processing if worker unavailable
- Reports upload status back to main thread

### 8. Callback Registry

Typed registry for 6 grouped callbacks:

| Callback | Events covered |
|---|---|
| `onRecordingStateChange` | started, paused, resumed, ended |
| `onAudioEvent` | user_speech, silence_warning, chunk_ready, frame_processed |
| `onUploadEvent` | progress, failed, retry |
| `onSessionEvent` | created, ended, status_update, partial_result |
| `onError` | vad_error, worker_error, transport_error, validation_error |
| `onTokenRequired` | token expired, consumer provides new token via resolver |

### 9. Validator

Validates all API interactions:

- **Request validation** — schema checks before sending (required fields, types, enums)
- **Response validation** — structure checks after receiving
- **Discovery-driven validation** — cross-validates requests against server capabilities (supported languages, upload methods, audio formats, chunk duration, model availability, session duration)

All validation errors throw `ValidationError` with descriptive messages.

---

## Directory Structure

```
src/
+-- client.ts                        # ScribeClient - thin public facade
+-- index.ts                         # Public exports
|
+-- types/
|   +-- session.ts                   # Session request/response types
|   +-- discovery.ts                 # Discovery document types
|   +-- recording.ts                 # Recording options, recorder interface
|   +-- callbacks.ts                 # Callback event types
|   +-- transport.ts                 # Transport request/response types
|   +-- common.ts                    # Shared types (errors, enums)
|
+-- constants/
|   +-- index.ts                     # Protocol constants, enums, status codes
|
+-- discovery/
|   +-- discovery-manager.ts         # Fetch, cache, expose discovery data
|   +-- resolved-config.ts           # Parse discovery doc -> runtime config
|
+-- session/
|   +-- session-manager.ts           # Session CRUD operations via transport
|
+-- recording/
|   +-- recording-manager.ts         # Recording lifecycle orchestration
|   +-- chunked-recorder.ts          # VAD-based chunked recording
|   +-- single-recorder.ts           # MediaRecorder single-file recording
|
+-- audio/
|   +-- vad-client.ts                # VAD initialization, frame processing, clip detection
|   +-- audio-buffer-manager.ts      # Raw audio frame accumulation
|   +-- audio-file-manager.ts        # Chunk metadata tracking
|   +-- mp3-encoder.ts               # Float32Array -> MP3 compression
|   +-- constants.ts                 # Audio constants (sample rate, chunk lengths, etc.)
|
+-- transport/
|   +-- transport.interface.ts       # ITransport interface
|   +-- http-transport.ts            # fetch-based implementation
|   +-- ipc-transport.ts             # Electron IPC implementation
|
+-- worker/
|   +-- shared-worker.ts             # Worker script (compress + upload)
|   +-- worker-manager.ts            # Spawn, communicate, fallback logic
|
+-- callbacks/
|   +-- callback-registry.ts         # Typed callback registration + dispatch
|
+-- validation/
|   +-- validator.ts                 # Main validator class
|   +-- schemas/
|       +-- discovery-schema.ts      # Discovery response validation rules
|       +-- session-schema.ts        # Session request/response validation rules
|       +-- request-schema.ts        # Recording options validation rules
|
+-- utils/
    +-- errors.ts                    # Error classes (ScribeError, ValidationError, etc.)
    +-- retry.ts                     # Generic retry utility with backoff
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Singleton ScribeClient | One recording session at a time. Prevents resource conflicts (mic access, worker). |
| Transport abstraction | IPC support requires network calls to be routable. Interface lets us swap without touching business logic. |
| VAD on main thread, compression + upload on worker | VAD needs `navigator.mediaDevices` (unavailable in workers). Compression is CPU-heavy and causes audio glitches on main thread. |
| Discovery-driven validation | Protocol compliance. SDK refuses invalid operations rather than letting the server reject them. |
| Grouped callbacks (6) over granular callbacks (18+) | Simpler consumer integration. Discriminated union types still give full type safety. |
| Pause = pause VAD only, no buffer flush | Simpler state management. Buffer continues from where it left off on resume. |
| Each manager owns its domain | Clear boundaries. RecordingManager doesn't know about session API. SessionManager doesn't know about audio. |

