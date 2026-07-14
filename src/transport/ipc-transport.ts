/**
 * IpcTransport — Electron IPC-based ITransport implementation.
 *
 * Routes all network requests through a consumer-provided IPC bridge
 * (e.g. Electron's ipcRenderer). The SDK never calls fetch() directly
 * when this transport is in use.
 *
 * - Serializes requests with a correlation ID for request/response matching
 * - Converts upload blobs to base64 for IPC serialization
 * - Same retry logic as HttpTransport (retries on SDK side)
 * - Auto-retries on 401 after token refresh (deduplicated across concurrent requests)
 */

import {
  ITransport,
  TransportRequest,
  TransportResponse,
  IpcBridge,
  IpcRequest,
} from './transport.interface';
import {
  TransportError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  ScribeError,
  SessionNotFoundError,
} from '../utils/errors';
import { retryWithBackoff, RetryOptions } from '../utils/retry';
import { HttpStatus, ErrorCode } from '../constants';
import type { IpcResponse } from '../types';

export class IpcTransport implements ITransport {
  private bridge: IpcBridge;
  private pendingRequests = new Map<
    string,
    {
      resolve: (response: IpcResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private accessToken?: string;
  private flavour?: string;
  private debug: boolean;
  private correlationCounter = 0;

  private onUnauthorized?: () => Promise<string | undefined>;

  // Deduplication: if a token refresh is in-flight, reuse the same promise
  private tokenRefreshPromise: Promise<string | undefined> | null = null;

  constructor(options: {
    bridge: IpcBridge;
    accessToken?: string;
    flavour?: string;
    debug?: boolean;
    onUnauthorized?: () => Promise<string | undefined>;
  }) {
    this.bridge = options.bridge;
    this.accessToken = options.accessToken;
    this.flavour = options.flavour;
    this.debug = options.debug ?? false;
    this.onUnauthorized = options.onUnauthorized;

    // Listen for responses from the host
    this.bridge.onResponse((response: IpcResponse) => {
      this.handleResponse(response);
    });
  }

  setAuthToken(token: string): void {
    this.accessToken = token;
  }

  async request<T = any>(config: TransportRequest): Promise<TransportResponse<T>> {
    try {
      // Backoff retry is only for audio uploads; every other request runs once.
      const result = config.isUpload
        ? await retryWithBackoff(() => this.executeRequest<T>(config), this.getRetryOptions(config))
        : await this.executeRequest<T>(config);
      return result;
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new TransportError(
        `IPC error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { url: config.url, method: config.method }
      );
    }
  }

  private async executeRequest<T>(config: TransportRequest): Promise<TransportResponse<T>> {
    const ipcResponse = await this.doIpcRequest(config);

    // Check for IPC-level errors (host couldn't process the request at all)
    if (ipcResponse.error) {
      throw new TransportError(ipcResponse.error, {
        url: config.url,
        method: config.method,
      });
    }

    // Success path
    if (ipcResponse.status < 400 || config.acceptStatuses?.includes(ipcResponse.status)) {
      return {
        status: ipcResponse.status,
        headers: ipcResponse.headers ?? {},
        data: ipcResponse.body as T,
      };
    }

    // 401 — attempt token refresh and retry once
    if (ipcResponse.status === HttpStatus.UNAUTHORIZED) {
      const newToken = await this.refreshToken();
      if (newToken) {
        // Retry with refreshed token (buildHeaders picks up this.accessToken)
        const retryResponse = await this.doIpcRequest(config);

        if (!retryResponse.error &&
            (retryResponse.status < 400 || config.acceptStatuses?.includes(retryResponse.status))) {
          return {
            status: retryResponse.status,
            headers: retryResponse.headers ?? {},
            data: retryResponse.body as T,
          };
        }
        // Retry also failed — throw as error
        return this.handleErrorResponse<T>(retryResponse, config);
      }
    }

    return this.handleErrorResponse<T>(ipcResponse, config);
  }

  /**
   * Execute a single IPC request with current auth headers.
   */
  private async doIpcRequest(config: TransportRequest): Promise<IpcResponse> {
    const correlationId = this.generateCorrelationId();
    const headers = this.buildHeaders(config);
    const ipcRequest = await this.buildIpcRequest(correlationId, config, headers);

    if (this.debug) {
      console.log('[ScribeSDK] IPC Request:', {
        correlationId,
        url: config.url,
        method: config.method,
        isUpload: config.isUpload ?? false,
      });
    }

    const ipcResponse = await this.sendAndWait(correlationId, ipcRequest);

    if (this.debug) {
      console.log('[ScribeSDK] IPC Response:', {
        correlationId,
        status: ipcResponse.status,
      });
    }

    return ipcResponse;
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

    // Presigned uploads authenticate via signed fields — no service auth/flavour.
    const isExternalUpload = config.isUpload === true && config.attachAuth === false;

    if (!config.isUpload) {
      headers['Content-Type'] = 'application/json';
      headers['Accept'] = 'application/json';
    } else if (!config.uploadFormFields) {
      headers['Content-Type'] = 'audio/mp3';
    }

    if (!isExternalUpload) {
      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
      }
      if (this.flavour) {
        headers['flavour'] = this.flavour;
      }
    }

    if (config.headers) {
      Object.assign(headers, config.headers);
    }

    return headers;
  }

  private async buildIpcRequest(
    correlationId: string,
    config: TransportRequest,
    headers: Record<string, string>
  ): Promise<IpcRequest> {
    const ipcRequest: IpcRequest = {
      correlationId,
      method: config.method,
      url: config.url,
      headers,
    };

    if (config.isUpload && config.uploadBlob) {
      // Serialize the file bytes to base64 for IPC transfer.
      const arrayBuffer = await config.uploadBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      ipcRequest.blobData = this.uint8ArrayToBase64(uint8Array);

      // FormData can't cross IPC — forward fields so the host builds the multipart.
      // TODO: requires Electron host support for multipart-from-fields uploads.
      if (config.uploadFormFields) {
        ipcRequest.uploadFormFields = config.uploadFormFields;
        ipcRequest.uploadFileFieldName = config.uploadFileFieldName ?? 'file';
        ipcRequest.uploadFileName = config.uploadFileName;
      }
    } else if (config.body !== undefined) {
      ipcRequest.body = config.body;
    }

    return ipcRequest;
  }

  private sendAndWait(correlationId: string, request: IpcRequest): Promise<IpcResponse> {
    return new Promise<IpcResponse>((resolve, reject) => {
      // Set a timeout to avoid hanging forever if host never responds
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(
          new TransportError('IPC request timed out after 15s', {
            correlationId,
            url: request.url,
          })
        );
      }, 15_000);

      this.pendingRequests.set(correlationId, {
        resolve: (response: IpcResponse) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        this.bridge.send(request);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(correlationId);
        reject(
          new TransportError(
            `Failed to send IPC request: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            { correlationId, url: request.url }
          )
        );
      }
    });
  }

  private handleResponse(response: IpcResponse): void {
    const pending = this.pendingRequests.get(response.correlationId);
    if (pending) {
      this.pendingRequests.delete(response.correlationId);
      pending.resolve(response);
    }
  }

  /**
   * Maps IPC error responses to typed SDK errors and throws.
   * 401 is NOT handled here — it's handled in executeRequest with auto-retry.
   */
  private handleErrorResponse<T>(
    response: IpcResponse,
    config: TransportRequest
  ): Promise<TransportResponse<T>> {
    const status = response.status;
    const body = response.body;

    const errorMessage = body?.error?.message ?? body?.message ?? 'Request failed';
    const errorCode = body?.error?.code ?? 'http_error';

    if (status === HttpStatus.UNAUTHORIZED) {
      throw new AuthenticationError(errorMessage, {
        url: config.url,
        ...body?.error?.details,
      });
    }

    if (status === HttpStatus.FORBIDDEN) {
      throw new ForbiddenError(errorMessage, {
        url: config.url,
        ...body?.error?.details,
      });
    }

    if (status === HttpStatus.NOT_FOUND) {
      throw new SessionNotFoundError(
        body?.error?.details?.session_id ?? config.url
      );
    }

    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      throw new ScribeError(errorMessage, ErrorCode.CHUNK_TOO_LARGE, status, {
        url: config.url,
        ...body?.error?.details,
      });
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      const retryAfter = parseInt(response.headers?.['retry-after'] ?? '', 10);
      throw new RateLimitError(isNaN(retryAfter) ? undefined : retryAfter);
    }

    throw new ScribeError(errorMessage, errorCode, status, body?.error?.details);
  }

  private generateCorrelationId(): string {
    this.correlationCounter += 1;
    return `ipc_${Date.now()}_${this.correlationCounter}`;
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private getRetryOptions(config: TransportRequest): RetryOptions {
    return {
      maxRetries: config.maxRetries,
      onRetry: (attempt, error) => {
        if (this.debug) {
          console.log(`[ScribeSDK] IPC Retry attempt ${attempt}:`, error.message);
        }
      },
    };
  }

  /**
   * Clean up pending requests (e.g. on SDK reset).
   */
  destroy(): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new TransportError('IPC transport destroyed'));
      this.pendingRequests.delete(id);
    }
  }
}
