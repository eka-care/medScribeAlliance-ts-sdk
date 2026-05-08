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
 */

import {
  ITransport,
  TransportRequest,
  TransportResponse,
  IpcBridge,
  IpcRequest,
} from './transport.interface';
import { TransportError, AuthenticationError, RateLimitError, ScribeError } from '../utils/errors';
import { retryWithBackoff, RetryOptions } from '../utils/retry';
import { HttpStatus } from '../constants';
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
  private apiKey?: string;
  private accessToken?: string;
  private debug: boolean;
  private correlationCounter = 0;

  constructor(options: {
    bridge: IpcBridge;
    apiKey?: string;
    accessToken?: string;
    debug?: boolean;
  }) {
    this.bridge = options.bridge;
    this.apiKey = options.apiKey;
    this.accessToken = options.accessToken;
    this.debug = options.debug ?? false;

    // Listen for responses from the host
    this.bridge.onResponse((response: IpcResponse) => {
      this.handleResponse(response);
    });
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
        `IPC error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { url: config.url, method: config.method }
      );
    }
  }

  private async executeRequest<T>(config: TransportRequest): Promise<TransportResponse<T>> {
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

    // Send request and wait for matching response
    const ipcResponse = await this.sendAndWait(correlationId, ipcRequest);

    if (this.debug) {
      console.log('[ScribeSDK] IPC Response:', {
        correlationId,
        status: ipcResponse.status,
      });
    }

    // Check for IPC-level errors (host couldn't process the request at all)
    if (ipcResponse.error) {
      throw new TransportError(ipcResponse.error, {
        url: config.url,
        method: config.method,
      });
    }

    // Map HTTP-level errors
    if (ipcResponse.status >= 400) {
      return this.handleErrorResponse<T>(ipcResponse, config);
    }

    return {
      status: ipcResponse.status,
      headers: ipcResponse.headers ?? {},
      data: ipcResponse.body as T,
    };
  }

  private buildHeaders(config: TransportRequest): Record<string, string> {
    const headers: Record<string, string> = {};

    if (!config.isUpload) {
      headers['Content-Type'] = 'application/json';
      headers['Accept'] = 'application/json';
    } else {
      headers['Content-Type'] = 'audio/mp3';
    }

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
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
      // Serialize blob to base64 for IPC transfer
      const arrayBuffer = await config.uploadBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      ipcRequest.blobData = this.uint8ArrayToBase64(uint8Array);
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
          new TransportError('IPC request timed out after 30s', {
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

  private getRetryOptions(): RetryOptions {
    return {
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
