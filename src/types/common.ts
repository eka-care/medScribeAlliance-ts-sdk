/**
 * Common / shared types used across the SDK
 */

import { ErrorCode } from '../constants';

export interface ApiError {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, any>;
}

export interface ErrorResponse {
  error: ApiError;
}
