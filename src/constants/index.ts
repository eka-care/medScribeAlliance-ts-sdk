/**
 * MedScribe Alliance Protocol Constants
 */

export const PROTOCOL_NAME = 'medscribealliance';
export const PROTOCOL_VERSION = '0.1';
export const WELL_KNOWN_PATH = '/.well-known/medscribealliance';

/** Discovery cache TTL in milliseconds (1 hour) */
export const DISCOVERY_CACHE_TTL_MS = 3600 * 1000;

// --- Enums ---

export enum SessionStatus {
  CREATED = 'created',
  RECORDING = 'recording',
  INITIALIZED = 'initialized',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  PARTIAL = 'partial',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export enum TemplateStatus {
  SUCCESS = 'success',
  PARTIAL_SUCCESS = 'partial_success',
  FAILURE = 'failure',
  IN_PROGRESS = 'in-progress',
}

export enum UploadType {
  CHUNKED = 'chunked',
  SINGLE = 'single',
  STREAM = 'stream',
}

export enum CommunicationProtocol {
  WEBSOCKET = 'websocket',
  HTTP = 'http',
  RPC = 'rpc',
}

export enum TransportMode {
  DIRECT = 'direct',
  IPC = 'ipc',
}

// --- Callback event type enums ---

export enum RecordingState {
  STARTED = 'started',
  PAUSED = 'paused',
  RESUMED = 'resumed',
  ENDED = 'ended',
}

export enum AudioEventType {
  USER_SPEECH = 'user_speech',
  SILENCE_WARNING = 'silence_warning',
  CHUNK_READY = 'chunk_ready',
  FRAME_PROCESSED = 'frame_processed',
}

export enum UploadEventType {
  PROGRESS = 'progress',
  FAILED = 'failed',
  RETRY = 'retry',
}

export enum SessionEventType {
  CREATED = 'created',
  ENDED = 'ended',
  DISCARDED = 'discarded',
  STATUS_UPDATE = 'status_update',
  PARTIAL_RESULT = 'partial_result',
}

export enum ErrorEventType {
  VAD_ERROR = 'vad_error',
  WORKER_ERROR = 'worker_error',
  TRANSPORT_ERROR = 'transport_error',
  VALIDATION_ERROR = 'validation_error',
}

export enum DiscardReason {
  CLEARED = 'cleared',
  CANCELLED = 'cancelled',
  RESET = 'reset',
}

export enum ErrorCode {
  // Authentication
  AUTHENTICATION_FAILED = 'authentication_failed',
  TOKEN_EXPIRED = 'token_expired',
  INVALID_API_KEY = 'invalid_api_key',

  // Authorization
  FORBIDDEN = 'forbidden',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',

  // Resource
  SESSION_NOT_FOUND = 'session_not_found',
  TEMPLATE_NOT_FOUND = 'template_not_found',
  SESSION_EXPIRED = 'session_expired',

  // Request
  INVALID_REQUEST = 'invalid_request',
  INVALID_AUDIO_FORMAT = 'invalid_audio_format',
  CHUNK_TOO_LARGE = 'chunk_too_large',
  INVALID_TEMPLATE = 'invalid_template',
  MISSING_REQUIRED_FIELD = 'missing_required_field',

  // Processing
  PROCESSING_FAILED = 'processing_failed',
  AUDIO_QUALITY_POOR = 'audio_quality_poor',
  AUDIO_TOO_SHORT = 'audio_too_short',
  LANGUAGE_UNSUPPORTED = 'language_unsupported',

  // Server
  INTERNAL_ERROR = 'internal_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',

  // SDK-specific
  DISCOVERY_FAILED = 'discovery_failed',
  TRANSPORT_ERROR = 'transport_error',
  WORKER_ERROR = 'worker_error',
  UPLOAD_FAILED = 'upload_failed',
  VAD_ERROR = 'vad_error',
  CHUNK_LENGTH_EXCEEDED = 'chunk_length_exceeded',
  CHUNK_LIMIT_REACHED = 'chunk_limit_reached',
  CHUNK_CREATION_FAILED = 'chunk_creation_failed',
  WORKER_POST_FAILED = 'worker_post_failed',
  SESSION_CREATION_FAILED = 'session_creation_failed',
  RECORDER_INIT_FAILED = 'recorder_init_failed',
  RECORDER_START_FAILED = 'recorder_start_failed',
  VAD_START_FAILED = 'vad_start_failed',
  STOP_FAILED = 'stop_failed',
  INTERNAL_RETRY_FAILED = 'internal_retry_failed',
  SESSION_END_FAILED = 'session_end_failed',

  // Storage providers
  UNSUPPORTED_STORAGE_PROVIDER = 'unsupported_storage_provider',
}

export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  GONE = 410,
  PAYLOAD_TOO_LARGE = 413,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  SERVICE_UNAVAILABLE = 503,
}

// --- Retry defaults ---

// Number of retries after the initial attempt.
// Total attempts per upload = 1 (initial) + DEFAULT_MAX_RETRIES = 3.
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MS = 2000;

// --- Polling defaults ---

export const DEFAULT_POLL_MAX_ATTEMPTS = 60;
export const DEFAULT_POLL_INTERVAL_MS = 2000;
