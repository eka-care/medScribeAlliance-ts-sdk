/**
 * Scribe EMR Protocol SDK
 * TypeScript SDK for the MedScribe Alliance Protocol
 * 
 * @packageDocumentation
 */

// Main client
export { ScribeClient } from './client';

// Types
export type {
  ScribeSDKConfig,
  RecordingOptions,
  DiscoveryDocument,
  CreateSessionResponse,
  GetSessionStatusResponse,
  EndSessionResponse,
  TemplatesOutput,
  TemplateEntry,
  ApiError,
  SDKEvent,
  SDKEventType,
  ServiceInfo,
  EndpointsInfo,
  AuthenticationInfo,
  CapabilitiesInfo,
  ModelConfig,
  LanguagesInfo,
  CreateSessionRequest,
  TemplateError,
  ProcessingError,
  ErrorResponse,
} from './types';

// Constants
export { SessionStatus, TemplateStatus, UploadType, ErrorCode, HttpStatus } from './constants';

// Errors
export {
  ScribeError,
  AuthenticationError,
  SessionNotFoundError,
  SessionExpiredError,
  RateLimitError,
  ValidationError,
} from './utils/errors';

// Validator
export { schemaValidator } from './utils/validator';
