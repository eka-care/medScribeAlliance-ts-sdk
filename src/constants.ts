/**
 * Protocol Constants
 * Based on MedScribe Alliance Protocol Specification
 */

export const PROTOCOL_NAME = 'medscribealliance';
export const PROTOCOL_VERSION = '0.1';

/**
 * Well-known endpoint for service discovery
 */
export const WELL_KNOWN_PATH = '/.well-known/medscribealliance';

/**
 * Session Status Values
 */
export enum SessionStatus {
  CREATED = 'created',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  PARTIAL = 'partial',
  FAILED = 'failed',
}

/**
 * Template Status Values
 */
export enum TemplateStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * Upload Type Values
 */
export enum UploadType {
  CHUNKED = 'chunked',
  SINGLE = 'single',
}

/**
 * Standard Error Codes from Protocol Spec 11
 */
export enum ErrorCode {
  // Authentication Errors
  AUTHENTICATION_FAILED = 'authentication_failed',
  TOKEN_EXPIRED = 'token_expired',
  INVALID_API_KEY = 'invalid_api_key',

  // Authorization Errors
  FORBIDDEN = 'forbidden',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',

  // Resource Errors
  SESSION_NOT_FOUND = 'session_not_found',
  TEMPLATE_NOT_FOUND = 'template_not_found',
  WEBHOOK_NOT_FOUND = 'webhook_not_found',
  SESSION_EXPIRED = 'session_expired',

  // Request Errors
  INVALID_REQUEST = 'invalid_request',
  INVALID_AUDIO_FORMAT = 'invalid_audio_format',
  CHUNK_TOO_LARGE = 'chunk_too_large',
  INVALID_TEMPLATE = 'invalid_template',
  MISSING_REQUIRED_FIELD = 'missing_required_field',

  // Processing Errors
  PROCESSING_FAILED = 'processing_failed',
  AUDIO_QUALITY_POOR = 'audio_quality_poor',
  AUDIO_TOO_SHORT = 'audio_too_short',
  LANGUAGE_UNSUPPORTED = 'language_unsupported',

  // Server Errors
  INTERNAL_ERROR = 'internal_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',
}

/**
 * HTTP Status Codes
 */
export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  PARTIAL_CONTENT = 206,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  GONE = 410,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  SERVICE_UNAVAILABLE = 503,
}
