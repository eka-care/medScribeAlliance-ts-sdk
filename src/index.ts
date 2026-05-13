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

  // Callbacks
  CallbackMap,
  CallbackName,
  RecordingState,
  RecordingStateChangeEvent,
  AudioEvent,
  AudioEventType,
  AudioEventUserSpeech,
  AudioEventSilenceWarning,
  AudioEventChunkReady,
  AudioEventFrameProcessed,
  UploadEvent,
  UploadEventType,
  UploadEventProgress,
  UploadEventFailed,
  UploadEventRetry,
  SessionEvent,
  SessionEventType,
  SessionEventCreated,
  SessionEventEnded,
  SessionEventStatusUpdate,
  SessionEventPartialResult,
  ErrorEvent,
  ErrorEventType,
  TokenRequiredEvent,

  // Worker
  MainToWorkerMessage,
  WorkerToMainMessage,

  // Common
  ApiError,
  ErrorResponse,
  SDKResult,
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
