/**
 * Transport layer types
 */

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  isUpload?: boolean;
  uploadBlob?: Blob;
  /** Additional HTTP status codes to treat as success (not throw). */
  acceptStatuses?: number[];
}

export interface TransportResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

export interface ITransport {
  request<T = any>(config: TransportRequest): Promise<TransportResponse<T>>;
  setAuthToken(token: string): void;
  setApiKey(apiKey: string): void;
}

/**
 * IPC bridge provided by the consumer (e.g. Electron host)
 */
export interface IpcBridge {
  send: (request: IpcRequest) => void;
  onResponse: (handler: (response: IpcResponse) => void) => void;
}

export interface IpcRequest {
  correlationId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  /** Base64-encoded blob data for uploads */
  blobData?: string;
}

export interface IpcResponse {
  correlationId: string;
  status: number;
  headers: Record<string, string>;
  body: any;
  error?: string;
}
