/**
 * Error class hierarchy for MedScribe Alliance TS SDK
 *
 * All SDK errors extend ScribeError. Each subclass maps to a specific
 * failure domain so consumers can catch precisely what they need.
 */

import { ErrorCode, HttpStatus } from '../constants';
import { ApiError } from '../types';

export class ScribeError extends Error {
  public readonly code: ErrorCode | string;
  public readonly httpStatus?: number;
  public readonly details?: Record<string, any>;

  constructor(
    message: string,
    code: ErrorCode | string = ErrorCode.INTERNAL_ERROR,
    httpStatus?: number,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ScribeError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;

    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, ScribeError);
    }
  }

  static fromApiError(apiError: ApiError, httpStatus?: number): ScribeError {
    return new ScribeError(apiError.message, apiError.code, httpStatus, apiError.details);
  }

  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      details: this.details,
    };
  }
}

export class ValidationError extends ScribeError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, ErrorCode.INVALID_REQUEST, HttpStatus.BAD_REQUEST, details);
    this.name = 'ValidationError';
  }
}

export class DiscoveryError extends ScribeError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, ErrorCode.DISCOVERY_FAILED, undefined, details);
    this.name = 'DiscoveryError';
  }
}

export class AuthenticationError extends ScribeError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, ErrorCode.AUTHENTICATION_FAILED, HttpStatus.UNAUTHORIZED, details);
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends ScribeError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, details);
    this.name = 'ForbiddenError';
  }
}

export class SessionNotFoundError extends ScribeError {
  constructor(sessionId: string) {
    super(
      `Session '${sessionId}' does not exist`,
      ErrorCode.SESSION_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      { session_id: sessionId }
    );
    this.name = 'SessionNotFoundError';
  }
}

export class SessionExpiredError extends ScribeError {
  constructor(sessionId: string, expiredAt?: string) {
    super(
      `Session '${sessionId}' has expired`,
      ErrorCode.SESSION_EXPIRED,
      HttpStatus.GONE,
      { session_id: sessionId, expired_at: expiredAt }
    );
    this.name = 'SessionExpiredError';
  }
}

export class RateLimitError extends ScribeError {
  constructor(retryAfter?: number) {
    super(
      `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter} seconds` : ''}`,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      HttpStatus.TOO_MANY_REQUESTS,
      retryAfter ? { retry_after_seconds: retryAfter } : undefined
    );
    this.name = 'RateLimitError';
  }
}

export class TransportError extends ScribeError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, ErrorCode.TRANSPORT_ERROR, undefined, details);
    this.name = 'TransportError';
  }
}

export class WorkerError extends ScribeError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, ErrorCode.WORKER_ERROR, undefined, details);
    this.name = 'WorkerError';
  }
}

export class UploadError extends ScribeError {
  public readonly failedFiles: string[];

  constructor(message: string, failedFiles: string[], details?: Record<string, any>) {
    super(message, ErrorCode.UPLOAD_FAILED, undefined, details);
    this.name = 'UploadError';
    this.failedFiles = failedFiles;
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      failedFiles: this.failedFiles,
    };
  }
}
