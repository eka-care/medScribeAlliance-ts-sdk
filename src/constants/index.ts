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

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 2000;

// --- Polling defaults ---

export const DEFAULT_POLL_MAX_ATTEMPTS = 60;
export const DEFAULT_POLL_INTERVAL_MS = 2000;
