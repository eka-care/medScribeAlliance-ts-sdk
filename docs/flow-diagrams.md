# MedScribe Alliance TS SDK - Flow Diagrams

---

## 1. SDK Initialization Flow

```
                    Consumer
                       |
                       v
           ScribeClient.getInstance(config)
                       |
                       v
               +---------------+
               | Validate      |
               | Config        |
               | - baseUrl     |
               | - auth        |
               | - mode        |
               +-------+-------+
                       |
                       v
               +---------------+
               | Create        |
               | Transport     |
               +-------+-------+
                       |
              +--------+---------+
              |                  |
              v                  v
     +----------------+  +---------------+
     | HttpTransport  |  | IpcTransport  |
     | (mode: direct) |  | (mode: ipc)   |
     +----------------+  +---------------+
              |                  |
              +--------+---------+
                       |
                       v
              client.init()
                       |
                       v
               +---------------+
               | Discovery     |
               | Manager       |
               | .fetch()      |
               +-------+-------+
                       |
                       v
               +---------------+
               | Validate      |
               | Discovery     |
               | Response      |
               +-------+-------+
                       |
                       v
               +---------------+
               | Parse into    |
               | ResolvedConfig|
               +-------+-------+
                       |
                       v
               +---------------+
               | Worker        |
               | Manager       |
               | .initialize() |
               +-------+-------+
                       |
              +--------+---------+---------+
              |                  |         |
              v                  v         v
         auto: detect      true: require  false: skip
         SharedWorker      SharedWorker
              |                  |
              v                  v
         available?        available?
         Y: spawn          Y: spawn
         N: fallback       N: throw error
                       |
                       v
                  SDK READY
```

---

## 2. Chunked Recording - Complete Flow

```
  client.startRecording({ uploadType: 'chunked', ... })
          |
          v
  +------------------+
  | Validate options |
  | vs schema +      |
  | vs discovery     |
  +--------+---------+
           |
           v
  +------------------+
  | Check mic        |
  | permission       |
  +--------+---------+
           |
           v
  +------------------+        +------------------+
  | SessionManager   |------->| Transport        |
  | .createSession() |        | POST /sessions   |
  +--------+---------+        +------------------+
           |
           v
  +------------------+
  | Validate         |
  | response         |
  +--------+---------+
           |
           v
  +------------------+
  | ChunkedRecorder  |
  | .initialize()    |
  +--------+---------+
           |
           v
  +------------------+
  | VadClient        |
  | .init(deviceId)  |
  +--------+---------+
           |
           v
  +------------------+
  | VadClient        |
  | .start()         |
  +--------+---------+
           |
           v
  === RECORDING ACTIVE ===
           |
           |  (continuous frame processing loop)
           |
           v
  +--------------------------------------------------+
  |                                                    |
  |  MicVAD.onFrameProcessed(prob, frame)             |
  |       |                                            |
  |       +---> FileManager.incrementRawSamples()      |
  |       +---> BufferManager.append(frame)            |
  |       +---> dispatch('onAudioEvent', frame_proc)   |
  |       |                                            |
  |       v                                            |
  |  VadClient.processVadFrame(decision)               |
  |       |                                            |
  |       +---> clip point detected?                   |
  |              |                                     |
  |              NO: continue loop                     |
  |              |                                     |
  |              YES:                                  |
  |               |                                    |
  |               v                                    |
  |        +--------------------+                      |
  |        | Get audio data     |                      |
  |        | from buffer        |                      |
  |        +---------+----------+                      |
  |                  |                                 |
  |                  v                                 |
  |        +--------------------+                      |
  |        | Build chunk        |                      |
  |        | metadata           |                      |
  |        | (name, timestamps) |                      |
  |        +---------+----------+                      |
  |                  |                                 |
  |                  v                                 |
  |        +--------------------+                      |
  |        | Reset buffer       |                      |
  |        +---------+----------+                      |
  |                  |                                 |
  |                  v                                 |
  |        +--------------------+                      |
  |        | WorkerManager      |                      |
  |        | .processChunk()    |                      |
  |        +---------+----------+                      |
  |                  |                                 |
  |         +--------+---------+                       |
  |         |                  |                       |
  |         v                  v                       |
  |  SharedWorker         Main Thread                  |
  |  available            fallback                     |
  |    |                     |                         |
  |    v                     v                         |
  |  worker.postMessage   Mp3Encoder                   |
  |    |                  .encode()                    |
  |    v                     |                         |
  |  [In Worker]:            v                         |
  |  Mp3Encoder           transport                    |
  |  .encode()            .upload()                    |
  |    |                     |                         |
  |    v                     |                         |
  |  fetch(uploadUrl)        |                         |
  |    |                     |                         |
  |    v                     v                         |
  |  postMessage          result                       |
  |  result back             |                         |
  |         |                |                         |
  |         +--------+-------+                         |
  |                  |                                 |
  |                  v                                 |
  |        +--------------------+                      |
  |        | Update chunk       |                      |
  |        | status in          |                      |
  |        | FileManager        |                      |
  |        +---------+----------+                      |
  |                  |                                 |
  |                  v                                 |
  |        dispatch('onUploadEvent', progress/failed)  |
  |                                                    |
  +--------------------------------------------------+
```

---

## 3. End Recording Flow

```
  client.endRecording()
          |
          v
  +------------------+
  | VadClient        |
  | .pause()         |
  | .destroy()       |
  +--------+---------+
           |
           v
  +------------------+       +------------------+
  | Buffer has       |--YES->| Flush last chunk |
  | remaining        |       | (compress +      |
  | samples?         |       |  upload)          |
  +--------+---------+       +--------+---------+
           |                          |
           NO                         |
           |                          |
           +----------+---------------+
                      |
                      v
           +------------------+
           | WorkerManager    |
           | .waitForAll()    |
           +--------+---------+
                    |
                    v
           +------------------+
           | Any failed       |
           | uploads?         |
           +--------+---------+
                    |
           +--------+---------+
           |                  |
           NO                YES
           |                  |
           |                  v
           |         +------------------+
           |         | Retry once       |
           |         +--------+---------+
           |                  |
           |         +--------+---------+
           |         |                  |
           |         NO (all ok)    YES (still failed)
           |         |                  |
           |         |                  v
           |         |         throw UploadError
           |         |         with failed file list
           +----+----+
                |
                v
       +------------------+        +-------------------+
       | SessionManager   |------->| Transport          |
       | .endSession()    |        | POST /sessions/end |
       +--------+---------+        +-------------------+
                |
                v
       +------------------+
       | Validate         |
       | response         |
       +--------+---------+
                |
                v
       dispatch('onSessionEvent', { type: 'ended' })
       dispatch('onRecordingStateChange', { type: 'ended' })
                |
                v
       +------------------+
       | VadClient        |
       | .reset()         |
       +------------------+
                |
                v
       Return EndSessionResponse
```

---

## 4. Transport Layer - Request Flow

```
  Any Manager calls transport.request(config)
          |
          v
  +------------------+
  | Which transport? |
  +--------+---------+
           |
  +--------+----------+
  |                   |
  v                   v
HTTP                 IPC
  |                   |
  v                   |
Add auth              v
headers          Serialize request
  |              + correlationId
  v                   |
fetch(url, opts)      v
  |              ipcTransport.send()
  v                   |
response              v
  |              ipcTransport.onResponse()
  |              (matched by correlationId)
  |                   |
  +--------+----------+
           |
           v
  +------------------+
  | Status 401?      |
  +--------+---------+
           |
  +--------+----------+
  |                   |
  NO                 YES
  |                   |
  |                   v
  |        +------------------+
  |        | dispatch         |
  |        | onTokenRequired  |
  |        | (with resolver)  |
  |        +--------+---------+
  |                 |
  |                 v
  |        Consumer provides
  |        new token
  |                 |
  |                 v
  |        transport.setAuthToken()
  |                 |
  |                 v
  |        Retry request
  |                 |
  +--------+--------+
           |
           v
  +------------------+
  | Status 2xx?      |
  +--------+---------+
           |
  +--------+----------+
  |                   |
  YES                NO
  |                   |
  v                   v
Return data     Map to typed error
                (ValidationError,
                 RateLimitError,
                 etc.)
                     |
                     v
                throw error
```

---

## 5. Pause / Resume Flow

```
  === RECORDING ACTIVE ===
           |
           v
  client.pauseRecording()
           |
           v
  +------------------+
  | Chunked:         |
  | VadClient.pause()|
  | (mic processing  |
  |  stops, buffer   |       Buffer state:
  |  stays intact)   |       [frame1][frame2][frame3]...
  |                  |        ^-- preserved, not flushed
  | Single:          |
  | MediaRecorder    |
  | .pause()         |
  +--------+---------+
           |
           v
  dispatch('onRecordingStateChange', { type: 'paused' })
           |
           v
  === RECORDING PAUSED ===
           |
           v
  client.resumeRecording()
           |
           v
  +------------------+
  | Chunked:         |
  | VadClient.start()|
  | (mic processing  |       Buffer state:
  |  resumes, new    |       [frame1][frame2][frame3][frame4][frame5]...
  |  frames appended |        preserved frames ^     ^ new frames
  |  after existing) |
  |                  |
  | Single:          |
  | MediaRecorder    |
  | .resume()        |
  +--------+---------+
           |
           v
  dispatch('onRecordingStateChange', { type: 'resumed' })
           |
           v
  === RECORDING ACTIVE ===
```

---

## 6. SharedWorker Communication

```
  +-------------------+                    +-------------------+
  |    Main Thread     |                    |   SharedWorker    |
  |                    |                    |                   |
  |  WorkerManager     |   postMessage      |                   |
  |  .processChunk()   |------------------->|  onmessage        |
  |                    |  {                 |  handler          |
  |                    |   type:            |       |           |
  |                    |   'compress_and_   |       v           |
  |                    |    upload',        | Mp3Encoder        |
  |                    |   audioFrames,     | .encode()         |
  |                    |   fileName,        |       |           |
  |                    |   uploadUrl,       |       v           |
  |                    |   headers          | fetch(url, blob)  |
  |                    |  }                 |       |           |
  |                    |                    |       v           |
  |  onmessage        |<-------------------|  postMessage      |
  |  handler          |  {                 |  {                |
  |       |           |   type:            |   type:           |
  |       v           |   'upload_success' |   'upload_success'|
  |  Update status    |   OR               |   OR              |
  |  Dispatch events  |   'upload_failed', |   'upload_failed' |
  |                   |   fileName,        |   fileName,       |
  |                   |   error?           |   error?          |
  +-------------------+  }                 +-------------------+
                                           |  }                |
                                           +-------------------+

  Token refresh in worker context:
  +-------------------+                    +-------------------+
  |    Main Thread     |                    |   SharedWorker    |
  |                    |    postMessage     |                   |
  |                    |<-------------------|  401 received     |
  |                    |  { type:           |  during upload    |
  |  dispatch          |  'token_required'} |                   |
  |  onTokenRequired   |                    |                   |
  |       |            |                    |                   |
  |       v            |                    |                   |
  |  Consumer provides |                    |                   |
  |  new token         |                    |                   |
  |       |            |   postMessage      |                   |
  |       v            |------------------->|                   |
  |  WorkerManager     |  { type:           |  Update token     |
  |  .updateToken()    |  'update_token',   |  Retry upload     |
  |                    |   token: '...' }   |                   |
  +-------------------+                    +-------------------+
```

---

## 7. Discovery-Driven Validation

```
  client.startRecording(options)
           |
           v
  +--------------------------------------+
  | Schema Validation                     |
  | (structure, types, required fields)   |
  +--------+-----------------------------+
           |
           v
  +--------------------------------------+
  | Discovery Capability Validation       |
  |                                       |
  |  options        ResolvedConfig        |
  |  -------        ---------------       |
  |  uploadType --> upload_methods[]      |
  |                 Supported? ----NO---> throw ValidationError
  |                     |                 "Upload type 'X' not
  |                    YES                 supported by server.
  |                     |                  Supported: [Y, Z]"
  |                     v                                      |
  |  languageHint -> supported[]          |
  |                 Supported? ----NO---> throw ValidationError
  |                     |                                      |
  |                    YES                                     |
  |                     v                                      |
  |  model --------> models[].id          |
  |                 Exists? -------NO---> throw ValidationError
  |                     |                                      |
  |                    YES                                     |
  |                     v                                      |
  +--------------------------------------+
           |
           v
  All validations passed.
  Proceed with session creation.
```

---

## 8. Full Session Lifecycle (Bird's Eye View)

```
  Consumer                   SDK                          Server
  --------                   ---                          ------
     |                        |                              |
     |--- getInstance(cfg) -->|                              |
     |                        |                              |
     |--- init() ----------->|                              |
     |                        |--- GET /.well-known -------->|
     |                        |<-- discovery doc ------------|
     |                        |                              |
     |                        | [parse ResolvedConfig]       |
     |                        | [init WorkerManager]         |
     |                        |                              |
     |<-- ready --------------|                              |
     |                        |                              |
     |--- startRecording() -->|                              |
     |                        | [validate vs discovery]      |
     |                        |--- POST /sessions ---------->|
     |                        |<-- { session_id, upload_url}-|
     |                        |                              |
     |                        | [init VAD, start recording]  |
     |                        |                              |
     |<-- onSessionEvent -----|                              |
     |    { type: 'created' } |                              |
     |                        |                              |
     |<-- onRecordingState ---|                              |
     |    { type: 'started' } |                              |
     |                        |                              |
     |                   [... recording in progress ...]     |
     |                        |                              |
     |<-- onAudioEvent -------|                              |
     |    { user_speech }     |                              |
     |                        |--- POST upload_url/chunk1 -->|
     |<-- onUploadEvent ------|<-- 200 ---------------------|
     |    { progress: 1/1 }   |                              |
     |                        |--- POST upload_url/chunk2 -->|
     |<-- onUploadEvent ------|<-- 200 ---------------------|
     |    { progress: 2/2 }   |                              |
     |                        |                              |
     |--- pauseRecording() -->|                              |
     |<-- onRecordingState ---|                              |
     |    { type: 'paused' }  |                              |
     |                        |                              |
     |--- resumeRecording() ->|                              |
     |<-- onRecordingState ---|                              |
     |    { type: 'resumed' } |                              |
     |                        |                              |
     |                   [... more chunks uploaded ...]      |
     |                        |                              |
     |--- endRecording() ---->|                              |
     |                        | [stop VAD, flush, wait]      |
     |                        |--- POST /sessions/{id}/end ->|
     |                        |<-- { status: processing } ---|
     |                        |                              |
     |<-- onSessionEvent -----|                              |
     |    { type: 'ended' }   |                              |
     |                        |                              |
     |--- pollForCompletion ->|                              |
     |                        |--- GET /sessions/{id} ------>|
     |<-- onSessionEvent -----|<-- { status: processing } ---|
     |    { status_update }   |                              |
     |                        |--- GET /sessions/{id} ------>|
     |<-- onSessionEvent -----|<-- { status: completed,  ----|
     |    { status_update }   |     templates: {...} }       |
     |                        |                              |
     |<-- final result -------|                              |
     |                        |                              |
```
