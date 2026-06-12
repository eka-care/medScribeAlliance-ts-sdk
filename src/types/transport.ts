/**
 * Transport layer types
 */

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  isUpload?: boolean;
  uploadBlob?: Blob;
  uploadFileName?: string;
  /** Multipart form fields; when set, the request is multipart/form-data with uploadBlob as the file. */
  uploadFormFields?: Record<string, string>;
  /** Multipart field name for the file part. Defaults to 'file'. */
  uploadFileFieldName?: string;
  /** Attach the service Bearer + flavour header. Defaults to true; false for presigned uploads. */
  attachAuth?: boolean;
  /** Additional HTTP status codes to treat as success (not throw). */
  acceptStatuses?: number[];
  maxRetries?: number;
}

export interface TransportResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

export interface ITransport {
  request<T = any>(config: TransportRequest): Promise<TransportResponse<T>>;
  setAuthToken(token: string): void;
  /** Clean up pending requests and resources. */
  destroy?(): void;
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
  /** Base64-encoded file bytes for uploads. */
  blobData?: string;
  /** Multipart fields for presigned uploads — host builds multipart from these + blobData (no auth header). */
  uploadFormFields?: Record<string, string>;
  /** Multipart field name for the file part. Defaults to 'file'. */
  uploadFileFieldName?: string;
  /** File name for the multipart file part. */
  uploadFileName?: string;
}

export interface IpcResponse {
  correlationId: string;
  status: number;
  headers: Record<string, string>;
  body: any;
  error?: string;
}
