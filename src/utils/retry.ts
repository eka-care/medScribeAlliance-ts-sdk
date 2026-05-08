/**
 * Generic retry utility with configurable backoff.
 *
 * - Retries on transient errors (5xx, 408, 429, network failures)
 * - Skips retry on client errors (4xx except 408/429) — those won't succeed on retry
 */

import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS } from '../constants';

export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
  /** Called before each retry. Return false to abort. */
  onRetry?: (attempt: number, error: Error) => boolean | void;
}

/**
 * Wraps an async function with retry logic.
 *
 * @param fn - The async operation to retry
 * @param options - Retry configuration
 * @returns The result of the first successful call
 * @throws The last error if all retries are exhausted
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    delayMs = DEFAULT_RETRY_DELAY_MS,
    onRetry,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 4xx client errors (except 408 Request Timeout and 429 Rate Limit)
      const statusCode = error?.httpStatus ?? error?.statusCode ?? error?.status;
      if (isNonRetryableStatus(statusCode)) {
        throw lastError;
      }

      // Last attempt — don't retry, just throw
      if (attempt >= maxRetries) {
        break;
      }

      // Allow consumer to abort retry
      if (onRetry) {
        const shouldContinue = onRetry(attempt + 1, lastError);
        if (shouldContinue === false) {
          break;
        }
      }

      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('Retry failed: unknown error');
}

/**
 * Returns true if the HTTP status code indicates a non-retryable client error.
 * 4xx errors (except 408 and 429) are not retryable.
 */
function isNonRetryableStatus(statusCode: unknown): boolean {
  if (typeof statusCode !== 'number') {
    return false;
  }
  return statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
