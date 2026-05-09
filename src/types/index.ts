/**
 * Public type exports for MedScribe Alliance TS SDK
 */

// Common
export type { ApiError, ErrorResponse, SDKResult } from './common';

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
  EndSessionRequest,
  EndSessionResponse,
  GetSessionStatusResponse,
  TemplatesOutput,
  TemplateEntry,
  TemplateError,
  ProcessingError,
  PollOptions,
} from './session';

// Recording
export type {
  RecordingOptions,
  RecorderConfig,
  IRecorder,
  StopRecordingResult,
  RetryUploadResult,
  AudioChunkInfo,
  UploadProgressCallback,
} from './recording';

// Callbacks
export type {
  RecordingState,
  RecordingStateChangeEvent,
  AudioEventType,
  AudioEvent,
  AudioEventUserSpeech,
  AudioEventSilenceWarning,
  AudioEventChunkReady,
  AudioEventFrameProcessed,
  UploadEventType,
  UploadEvent,
  UploadEventProgress,
  UploadEventFailed,
  UploadEventRetry,
  SessionEventType,
  SessionEvent,
  SessionEventCreated,
  SessionEventEnded,
  SessionEventStatusUpdate,
  SessionEventPartialResult,
  ErrorEventType,
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
