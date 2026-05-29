/**
 * MedScribe Alliance TS SDK
 * TypeScript SDK for the MedScribe Alliance Protocol
 *
 * @packageDocumentation
 */

// --- Main client ---
export { ScribeClient } from './client';

// --- Types ---
export type {
  // Config
  ScribeSDKConfig,

  // Transport
  ITransport,
  TransportRequest,
  TransportResponse,
  IpcBridge,
  IpcRequest,
  IpcResponse,

  // Discovery
  DiscoveryDocument,
  ServiceInfo,
  EndpointsInfo,
  AuthenticationInfo,
  CapabilitiesInfo,
  ModelConfig,
  LanguagesInfo,
  ResolvedConfig,

  // Session
  CreateSessionRequest,
  CreateSessionResponse,
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

  // Recording
  RecordingOptions,
  RecorderConfig,
  IRecorder,
  StopRecordingResult,
  EndRecordingResult,
  RetryUploadResult,
  AudioChunkInfo,

  // Callbacks (enum types are exported as values from ./constants)
  CallbackMap,
  CallbackName,
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

  // Worker
  MainToWorkerMessage,
  WorkerToMainMessage,

  // Common
  ApiError,
  ErrorResponse,
  SDKResult,
  ApiCallResult,
} from './types';

// --- Constants & Enums ---
export {
  SessionStatus,
  TemplateStatus,
  UploadType,
  CommunicationProtocol,
  TransportMode,
  ErrorCode,
  HttpStatus,
  RecordingState,
  AudioEventType,
  UploadEventType,
  SessionEventType,
  ErrorEventType,
  DiscardReason,
} from './constants';

// --- Errors ---
export {
  ScribeError,
  ValidationError,
  DiscoveryError,
  AuthenticationError,
  ForbiddenError,
  SessionNotFoundError,
  SessionExpiredError,
  RateLimitError,
  TransportError,
  WorkerError,
  UploadError,
} from './utils/errors';

// --- Managers (for advanced usage / testing) ---
export { CallbackRegistry } from './callbacks/callback-registry';
export { DiscoveryManager } from './discovery/discovery-manager';
export { SessionManager } from './session/session-manager';
export { RecordingManager } from './recording/recording-manager';
export type { RecordingManagerConfig } from './recording/recording-manager';

// --- Transport implementations (for advanced usage) ---
export { HttpTransport } from './transport/http-transport';
export { IpcTransport } from './transport/ipc-transport';

// --- Validation ---
export { Validator } from './validation/validator';

// --- Worker URL utility ---
export { getWorkerUrl, createWorkerBlobUrl } from './utils/get-worker-url';
