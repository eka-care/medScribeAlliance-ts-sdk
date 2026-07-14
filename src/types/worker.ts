/**
 * SharedWorker message protocol types
 */

// --- Main thread -> Worker ---

export interface WorkerCompressAndUploadMessage {
  type: 'compress_and_upload';
  audioFrames: Float32Array;
  fileName: string;
  storageProvider: string;
  /** Provider-specific upload payload from the create-session response. */
  upload: unknown;
  headers: Record<string, string>;
}

export interface WorkerWaitForUploadsMessage {
  type: 'wait_for_all_uploads';
}

export interface WorkerUpdateTokenMessage {
  type: 'update_auth_token';
  token: string;
}

/** Fresh upload payload sent in response to an upload_url_required request. */
export interface WorkerUpdateUploadUrlMessage {
  type: 'update_upload_url';
  /** Provider-specific upload payload from a fresh getSessionStatus call. Null = no refresh available. */
  upload: unknown | null;
}

export interface WorkerTerminateMessage {
  type: 'terminate';
}

export type MainToWorkerMessage =
  | WorkerCompressAndUploadMessage
  | WorkerWaitForUploadsMessage
  | WorkerUpdateTokenMessage
  | WorkerUpdateUploadUrlMessage
  | WorkerTerminateMessage;

// --- Worker -> Main thread ---

export interface WorkerChunkEncodedMessage {
  type: 'chunk_encoded';
  fileName: string;
  chunkData: Uint8Array[];
}

export interface WorkerUploadSuccessMessage {
  type: 'upload_success';
  fileName: string;
}

export interface WorkerUploadFailedMessage {
  type: 'upload_failed';
  fileName: string;
  error: string;
  chunkData?: Uint8Array[];
}

export interface WorkerAllUploadsCompleteMessage {
  type: 'all_uploads_complete';
}

export interface WorkerTokenRequiredMessage {
  type: 'token_required';
}

/** Worker hit an upload error and wants a fresh upload_url before retrying. */
export interface WorkerUploadUrlRequiredMessage {
  type: 'upload_url_required';
  fileName: string;
}

export type WorkerToMainMessage =
  | WorkerChunkEncodedMessage
  | WorkerUploadSuccessMessage
  | WorkerUploadFailedMessage
  | WorkerAllUploadsCompleteMessage
  | WorkerTokenRequiredMessage
  | WorkerUploadUrlRequiredMessage;
