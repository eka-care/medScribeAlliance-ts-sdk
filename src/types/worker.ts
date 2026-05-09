/**
 * SharedWorker message protocol types
 */

// --- Main thread -> Worker ---

export interface WorkerCompressAndUploadMessage {
  type: 'compress_and_upload';
  audioFrames: Float32Array;
  fileName: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface WorkerWaitForUploadsMessage {
  type: 'wait_for_all_uploads';
}

export interface WorkerUpdateTokenMessage {
  type: 'update_auth_token';
  token: string;
}

export interface WorkerTerminateMessage {
  type: 'terminate';
}

export type MainToWorkerMessage =
  | WorkerCompressAndUploadMessage
  | WorkerWaitForUploadsMessage
  | WorkerUpdateTokenMessage
  | WorkerTerminateMessage;

// --- Worker -> Main thread ---

export interface WorkerUploadSuccessMessage {
  type: 'upload_success';
  fileName: string;
}

export interface WorkerUploadFailedMessage {
  type: 'upload_failed';
  fileName: string;
  error: string;
  blob?: Blob;
}

export interface WorkerAllUploadsCompleteMessage {
  type: 'all_uploads_complete';
}

export interface WorkerTokenRequiredMessage {
  type: 'token_required';
}

export type WorkerToMainMessage =
  | WorkerUploadSuccessMessage
  | WorkerUploadFailedMessage
  | WorkerAllUploadsCompleteMessage
  | WorkerTokenRequiredMessage;
