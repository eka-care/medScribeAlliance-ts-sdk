/**
 * Shared helper: upload one file to storage via the selected provider + transport.
 * Used by the recorders, retry pass, and the pre-recorded single-file upload.
 */

import type { ITransport, TransportResponse } from '../types/transport';
import type { SessionUploadInfo } from '../types/session';
import { getStorageProvider } from './storage-provider-factory';

export interface UploadFileParams {
  fileName: string;
  blob: Blob;
  upload: SessionUploadInfo;
  storageProvider: string;
  maxRetries?: number;
}

/**
 * Resolve the provider, build its request, and send via the transport.
 * Returns the full storage response (status, headers, body).
 * @throws UnsupportedStorageProviderError | UploadError | TransportError
 *
 * TODO: Handle presigned URL expiration for long recordings (403 on expired policy).
 */
export async function uploadFileToStorage(
  transport: ITransport,
  params: UploadFileParams
): Promise<TransportResponse> {
  const provider = getStorageProvider(params.storageProvider);

  const prepared = provider.prepareUpload({
    fileName: params.fileName,
    blob: params.blob,
    upload: params.upload,
  });

  const response = await transport.request({
    method: prepared.method,
    url: prepared.url,
    headers: prepared.headers,
    isUpload: true,
    uploadBlob: params.blob,
    uploadFormFields: prepared.formFields,
    uploadFileFieldName: prepared.fileFieldName,
    uploadFileName: params.fileName,
    attachAuth: prepared.attachAuth,
    maxRetries: params.maxRetries,
  });

  return response;
}
