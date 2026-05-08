/**
 * HttpTransport — fetch-based ITransport implementation.
 *
 * - Adds auth headers (API key or Bearer token)
 * - JSON requests for API calls, raw blob for uploads
 * - Retry logic via retryWithBackoff (3 attempts, 2s delay, skip 4xx)
 * - Maps HTTP errors to typed ScribeError subclasses
 */

import { ITransport, TransportRequest, TransportResponse } from './transport.interface';
import { HttpStatus } from '../constants';
import {
  ScribeError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  TransportError,
} from '../utils/errors';
import { retryWithBackoff, RetryOptions } from '../utils/retry';

export class HttpTransport implements ITransport {
  private apiKey?: string;
  private accessToken?: string;
  private debug: boolean;
  private onUnauthorized?: () => void;

  constructor(options: {
    apiKey?: string;
    accessToken?: string;
    debug?: boolean;
    onUnauthorized?: () => void;
  }) {
    this.apiKey = options.apiKey;
    this.accessToken = options.accessToken;
    this.debug = options.debug ?? false;
    this.onUnauthorized = options.onUnauthorized;
  }

  setAuthToken(token: string): void {
    this.accessToken = token;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async request<T = any>(config: TransportRequest): Promise<TransportResponse<T>> {
    try {
      const result = await retryWithBackoff(
        () => this.executeRequest<T>(config),
        this.getRetryOptions()
      );
      return result;
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new TransportError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { url: config.url, method: config.method }
      );
    }
  }

  private async executeRequest<T>(config: TransportRequest): Promise<TransportResponse<T>> {
    const headers = this.buildHeaders(config);
    const requestInit = this.buildRequestInit(config, headers);

    if (this.debug) {
      console.log('[ScribeSDK] HTTP Request:', {
        url: config.url,
        method: config.method,
        headers,
        isUpload: config.isUpload ?? false,
      });
    }

    let response: Response;
    try {
      response = await fetch(config.url, requestInit);
    } catch (error) {
      throw new TransportError(
        `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { url: config.url, method: config.method }
      );
    }

    if (this.debug) {
      console.log('[ScribeSDK] HTTP Response:', {
        status: response.status,
        statusText: response.statusText,
      });
    }

    if (response.ok || config.acceptStatuses?.includes(response.status)) {
      return this.buildSuccessResponse<T>(response);
    }

    return this.handleErrorResponse(response, config);
  }

  private buildHeaders(config: TransportRequest): Record<string, string> {
    const headers: Record<string, string> = {};

    // For non-upload requests, set JSON content type
    if (!config.isUpload) {
      headers['Content-Type'] = 'application/json';
      headers['Accept'] = 'application/json';
    } else {
      // Upload requests send raw blob with audio content type
      headers['Content-Type'] = 'audio/mp3';
    }

    // Auth headers
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    // Merge any caller-provided headers (overrides defaults)
    if (config.headers) {
      Object.assign(headers, config.headers);
    }

    return headers;
  }

  private buildRequestInit(config: TransportRequest, headers: Record<string, string>): RequestInit {
    const init: RequestInit = {
      method: config.method,
      headers,
      credentials: 'include',
    };

    if (config.isUpload && config.uploadBlob) {
      init.body = config.uploadBlob;
    } else if (config.body !== undefined) {
      init.body = JSON.stringify(config.body);
    }

    return init;
  }

  private async buildSuccessResponse<T>(response: Response): Promise<TransportResponse<T>> {
    const responseHeaders = this.extractHeaders(response);

    // Some endpoints may return empty body (e.g. 204)
    let data: T;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      // For upload responses, return ETag or status text
      const etag = response.headers.get('ETag');
      data = { success: etag ?? 'OK' } as unknown as T;
    }

    return {
      status: response.status,
      headers: responseHeaders,
      data,
    };
  }

  /**
   * Maps HTTP error responses to typed SDK errors and throws.
   * This method always throws — the return type is `never` (expressed as
   * Promise<TransportResponse<T>> so the caller's type flow stays clean).
   */
  private async handleErrorResponse<T>(
    response: Response,
    config: TransportRequest
  ): Promise<TransportResponse<T>> {
    const status = response.status;

    // Try to parse error body
    let errorBody: any = null;
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error body — fall through to generic handling
    }

    const errorMessage =
      errorBody?.error?.message ?? errorBody?.message ?? response.statusText ?? 'Request failed';

    const errorCode = errorBody?.error?.code ?? 'http_error';

    // Map to specific error types
    if (status === HttpStatus.UNAUTHORIZED) {
      this.onUnauthorized?.();
      throw new AuthenticationError(errorMessage, {
        url: config.url,
        ...errorBody?.error?.details,
      });
    }

    if (status === HttpStatus.FORBIDDEN) {
      throw new ForbiddenError(errorMessage, {
        url: config.url,
        ...errorBody?.error?.details,
      });
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      const retryAfter = parseInt(response.headers.get('Retry-After') ?? '', 10);
      throw new RateLimitError(isNaN(retryAfter) ? undefined : retryAfter);
    }

    // Generic ScribeError for other status codes — includes httpStatus
    // so retryWithBackoff can decide whether to retry
    const error = new ScribeError(errorMessage, errorCode, status, errorBody?.error?.details);
    throw error;
  }

  private extractHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  private getRetryOptions(): RetryOptions {
    return {
      onRetry: (attempt, error) => {
        if (this.debug) {
          console.log(`[ScribeSDK] Retry attempt ${attempt}:`, error.message);
        }
      },
    };
  }
}
