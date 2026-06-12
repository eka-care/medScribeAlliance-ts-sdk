/**
 * Public type exports for MedScribe Alliance TS SDK
 */

// Common
export type { ApiError, ErrorResponse, SDKResult, ApiCallResult } from './common';

// Config
export type { ScribeSDKConfig } from './config';

// Transport
export type {
  TransportRequest,
  TransportResponse,
  ITransport,
  IpcBridge,
  IpcRequest,
  IpcResponse,
} from './transport';

// Discovery
export type {
  DiscoveryDocument,
  ServiceInfo,
  EndpointsInfo,
  AuthenticationInfo,
  CapabilitiesInfo,
  ModelConfig,
  LanguagesInfo,
  ResolvedConfig,
} from './discovery';

// Session
export type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionUploadInfo,
  EndSessionRequest,
  EndSessionResponse,
  GetSessionStatusResponse,
  TemplateEntry,
  TemplateEntryData,
  TemplateError,
  ProcessingError,
  PollOptions,
  PatientDetails,
  PatchSessionRequest,
  PatchSessionResponse,
  ProcessTemplateResponse,
} from './session';

// Recording
export type {
  RecordingOptions,
  RecorderConfig,
  IRecorder,
  StopRecordingResult,
  EndRecordingResult,
  RetryUploadResult,
  AudioChunkInfo,
  UploadProgressCallback,
} from './recording';

// Callbacks (enum types are exported as values from ../constants)
export type {
  RecordingStateChangeEvent,
  AudioEvent,
  AudioEventUserSpeech,
  AudioEventSilenceWarning,
  AudioEventChunkReady,
  AudioEventFrameProcessed,
  UploadEvent,
  UploadEventProgress,
  UploadEventFailed,
  UploadEventRetry,
  SessionEvent,
  SessionEventCreated,
  SessionEventEnded,
  SessionEventDiscarded,
  SessionEventStatusUpdate,
  SessionEventPartialResult,
  ErrorEvent,
  TokenRequiredEvent,
  CallbackMap,
  CallbackName,
} from './callbacks';

// Worker
export type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerCompressAndUploadMessage,
  WorkerWaitForUploadsMessage,
  WorkerUpdateTokenMessage,
  WorkerTerminateMessage,
  WorkerUploadSuccessMessage,
  WorkerUploadFailedMessage,
  WorkerAllUploadsCompleteMessage,
  WorkerTokenRequiredMessage,
} from './worker';
