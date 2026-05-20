/**
 * Common / shared types used across the SDK
 */

import { ErrorCode } from '../constants';
import type { ScribeError } from '../utils/errors';

export interface ApiError {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, any>;
}

export interface ErrorResponse {
  error: ApiError;
}

/**
 * Result type for all public SDK methods.
 * Expected errors (API failures, auth, validation) are returned — not thrown.
 *
 * `httpStatus` is set when the result was produced by an HTTP call (success or error).
 * It will be undefined for purely local operations (e.g. cached discovery, no-op init).
 */
export type SDKResult<T = void> =
  | { success: true; data: T; httpStatus?: number }
  | { success: false; error: ScribeError };

/**
 * Internal return shape for manager methods that wrap an HTTP call.
 * Carries the HTTP status alongside the parsed response data so the
 * ScribeClient boundary can surface it on SDKResult.
 *
 * For composed operations (e.g. recording start = createSession + recorder init),
 * httpStatus reflects the most relevant HTTP call. It is optional because some
 * code paths (cache hits, no-op flows) don't make a request.
 */
export type ApiCallResult<T> = { data: T; httpStatus?: number };
