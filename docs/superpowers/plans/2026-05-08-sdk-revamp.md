# SDK Architecture Revamp - Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp medScribeAlliance-ts-sdk into a layered architecture with transport abstraction, discovery-driven validation, SharedWorker support, and grouped callback system.

**Architecture:** Layered — ScribeClient (thin facade) delegates to managers (Discovery, Session, Recording). Transport layer abstracts HTTP/IPC. Audio layer (VAD, Buffer, FileManager, Mp3Encoder) feeds into WorkerManager for compression+upload. CallbackRegistry dispatches 6 grouped event types.

**Tech Stack:** TypeScript, @ricky0123/vad-web, @breezystack/lamejs, SharedWorker API

---

## Task Overview

| Task | Component | Dependencies |
|------|-----------|-------------|
| 1 | Types & Constants | None |
| 2 | Error Classes & Retry Utility | Task 1 |
| 3 | Callback Registry | Task 1 |
| 4 | Transport Layer (interface + HTTP + IPC) | Task 1, 2 |
| 5 | Validation (schemas + validator) | Task 1, 2 |
| 6 | Discovery (manager + resolved config) | Task 1, 2, 4, 5 |
| 7 | Session Manager | Task 1, 2, 4, 5, 6 |
| 8 | Audio Layer (buffer, file manager, mp3, vad) | Task 1, 2, 3 |
| 9 | Worker (manager + worker script) | Task 1, 2, 3, 4, 8 |
| 10 | Recorders (chunked + single) | Task 1-9 |
| 11 | Recording Manager | Task 1-10 |
| 12 | ScribeClient + index.ts | Task 1-11 |
| 13 | Example: Dummy Integration | Task 1-12 |

---

### Task 1: Types & Constants

**Files:**
- Create: `src/types/common.ts`
- Create: `src/types/transport.ts`
- Create: `src/types/discovery.ts`
- Create: `src/types/session.ts`
- Create: `src/types/recording.ts`
- Create: `src/types/callbacks.ts`
- Create: `src/types/index.ts`
- Create: `src/constants/index.ts`

**What this does:** Defines every type, interface, and enum the SDK uses. All other tasks import from here.

---

### Task 2: Error Classes & Retry Utility

**Files:**
- Create: `src/utils/errors.ts`
- Create: `src/utils/retry.ts`

**What this does:** Typed error hierarchy (ScribeError base + subclasses). Generic retry utility with configurable backoff and skip-on-4xx logic.

---

### Task 3: Callback Registry

**Files:**
- Create: `src/callbacks/callback-registry.ts`

**What this does:** Typed registry for 6 grouped callbacks. Provides `register()`, `dispatch()`, `remove()`, `removeAll()`. Each dispatch wraps handler calls in try/catch so a bad consumer handler doesn't crash the SDK.

---

### Task 4: Transport Layer

**Files:**
- Create: `src/transport/transport.interface.ts`
- Create: `src/transport/http-transport.ts`
- Create: `src/transport/ipc-transport.ts`

**What this does:** `ITransport` interface. `HttpTransport` uses fetch with auth headers and retry. `IpcTransport` routes requests through consumer-provided IPC bridge with correlation ID matching.

---

### Task 5: Validation

**Files:**
- Create: `src/validation/schemas/discovery-schema.ts`
- Create: `src/validation/schemas/session-schema.ts`
- Create: `src/validation/schemas/request-schema.ts`
- Create: `src/validation/validator.ts`

**What this does:** Schema validation for every API request/response. Discovery-driven validation (cross-check against server capabilities). All throw `ValidationError` with descriptive messages.

---

### Task 6: Discovery Manager

**Files:**
- Create: `src/discovery/resolved-config.ts`
- Create: `src/discovery/discovery-manager.ts`

**What this does:** Fetches well-known endpoint via transport, validates response, parses into `ResolvedConfig`. Caches with 1hr TTL. Exposes convenience getters for all discovery data.

---

### Task 7: Session Manager

**Files:**
- Create: `src/session/session-manager.ts`

**What this does:** Session CRUD via transport. `createSession()`, `endSession()`, `getSessionStatus()`, `pollForCompletion()`. Validates all requests/responses through Validator.

---

### Task 8: Audio Layer

**Files:**
- Create: `src/audio/constants.ts`
- Create: `src/audio/mp3-encoder.ts`
- Create: `src/audio/audio-buffer-manager.ts`
- Create: `src/audio/audio-file-manager.ts`
- Create: `src/audio/vad-client.ts`

**What this does:** Audio pipeline components. VAD detects clip points only (no upload). Buffer accumulates frames. FileManager tracks metadata. Mp3Encoder is a pure compression function.

---

### Task 9: Worker Manager

**Files:**
- Create: `src/worker/shared-worker.ts`
- Create: `src/worker/worker-manager.ts`

**What this does:** WorkerManager spawns SharedWorker (or falls back to main thread). Worker script handles MP3 compression + HTTP upload. Message protocol for communication.

---

### Task 10: Recorders

**Files:**
- Create: `src/recording/chunked-recorder.ts`
- Create: `src/recording/single-recorder.ts`

**What this does:** `ChunkedRecorder` wires VAD → buffer → file manager → worker manager. `SingleRecorder` uses MediaRecorder API. Both implement `IRecorder` interface.

---

### Task 11: Recording Manager

**Files:**
- Create: `src/recording/recording-manager.ts`

**What this does:** Orchestrates recording lifecycle. `start()` validates options, creates session, initializes recorder. `pause()`/`resume()` delegate to recorder. `stop()` flushes, waits for uploads, ends session.

---

### Task 12: ScribeClient & Public Exports

**Files:**
- Create: `src/client.ts` (rewrite)
- Create: `src/index.ts` (rewrite)

**What this does:** Thin facade delegating to all managers. `index.ts` re-exports the public API surface.

---

### Task 13: Example — Dummy Integration

**Files:**
- Create: `examples/basic-usage.js`

**What this does:** A complete working example showing how a consumer integrates the SDK. Covers: initialization (both direct and IPC mode), callback registration, starting a chunked recording, pausing/resuming, ending recording, polling for results, accessing discovery data, and error handling. Serves as living documentation and a quick smoke-test reference.

---

## Execution Order

Tasks 1-3 are foundation (no external dependencies between them). Tasks 4-5 depend on foundation. Tasks 6-7 depend on transport+validation. Tasks 8-9 depend on foundation+transport. Tasks 10-12 wire everything together. Task 13 is the final validation that the public API is coherent.

Each task will be implemented one at a time for review before proceeding to the next.
