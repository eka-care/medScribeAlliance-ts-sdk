/**
 * HttpTransport — fetch-based ITransport implementation.
 *
 * - Adds auth headers (API key or Bearer token)
 * - JSON requests for API calls, raw blob for uploads
 * - Retry logic via retryWithBackoff (1 initial + 3 retries, 2s delay, skip 4xx)
 * - Maps HTTP errors to typed ScribeError subclasses
 * - Auto-retries on 401 after token refresh (deduplicated across concurrent requests)
 */

import { ITransport, TransportRequest, TransportResponse } from './transport.interface';
import { HttpStatus, ErrorCode } from '../constants';
import {
  ScribeError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  TransportError,
  SessionNotFoundError,
} from '../utils/errors';
import { retryWithBackoff, RetryOptions } from '../utils/retry';

export class HttpTransport implements ITransport {
  private accessToken?: string;
  private flavour?: string;
  private debug: boolean;
  private onUnauthorized?: () => Promise<string | undefined>;

  // Deduplication: if a token refresh is in-flight, reuse the same promise
  private tokenRefreshPromise: Promise<string | undefined> | null = null;

  constructor(options: {
    accessToken?: string;
    flavour?: string;
    debug?: boolean;
    onUnauthorized?: () => Promise<string | undefined>;
  }) {
    this.accessToken = options.accessToken;
    this.flavour = options.flavour;
    this.debug = options.debug ?? false;
    this.onUnauthorized = options.onUnauthorized;
  }

  setAuthToken(token: string): void {
    this.accessToken = token;
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
    const response = await this.doFetch(config);

    if (response.ok || config.acceptStatuses?.includes(response.status)) {
      return this.buildSuccessResponse<T>(response);
    }

    // 401 — attempt token refresh and retry once
    if (response.status === HttpStatus.UNAUTHORIZED) {
      const newToken = await this.refreshToken();
      if (newToken) {
        // Retry with refreshed token (buildHeaders picks up this.accessToken)
        const retryResponse = await this.doFetch(config);
        if (retryResponse.ok || config.acceptStatuses?.includes(retryResponse.status)) {
          return this.buildSuccessResponse<T>(retryResponse);
        }
        // Retry also failed — throw as error
        return this.handleErrorResponse(retryResponse, config);
      }
    }

    return this.handleErrorResponse(response, config);
  }

  /**
   * Execute a single fetch call with current auth headers.
   */
  private async doFetch(config: TransportRequest): Promise<Response> {
    const headers = this.buildHeaders(config);
    const requestInit = this.buildRequestInit(config, headers);

    if (this.debug) {
      console.log('[ScribeSDK] HTTP Request:', {
        url: config.url,
        method: config.method,
        isUpload: config.isUpload ?? false,
      });
    }

    try {
      const response = await fetch(config.url, requestInit);

      if (this.debug) {
        console.log('[ScribeSDK] HTTP Response:', {
          status: response.status,
          statusText: response.statusText,
        });
      }

      return response;
    } catch (error) {
      throw new TransportError(
        `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { url: config.url, method: config.method }
      );
    }
  }

  /**
   * Deduplicated token refresh.
   * If multiple requests get 401 simultaneously, only one onTokenRequired
   * callback fires — the rest await the same promise.
   */
  private async refreshToken(): Promise<string | undefined> {
    // Reuse in-flight refresh
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    if (!this.onUnauthorized) {
      return undefined;
    }

    this.tokenRefreshPromise = this.onUnauthorized();
    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
    }
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

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (this.flavour) {
      headers['flavour'] = this.flavour;
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
   * 401 is NOT handled here — it's handled in executeRequest with auto-retry.
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

    if (status === HttpStatus.UNAUTHORIZED) {
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

    if (status === HttpStatus.NOT_FOUND) {
      throw new SessionNotFoundError(
        errorBody?.error?.details?.session_id ?? config.url
      );
    }

    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      throw new ScribeError(errorMessage, ErrorCode.CHUNK_TOO_LARGE, status, {
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

  /**
   * Cancel in-flight fetch requests by aborting (best-effort).
   * HttpTransport has no pending-request map, so this is a no-op.
   * Included for ITransport interface parity with IpcTransport.
   */
  destroy(): void {
    // No pending-request tracking in fetch-based transport.
    // In-flight fetches will resolve/reject naturally.
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
