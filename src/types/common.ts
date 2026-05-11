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
 */
export type SDKResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: ScribeError };
