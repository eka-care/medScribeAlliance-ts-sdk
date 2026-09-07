// The single place that decides which StorageProvider owns a session's upload_url.
// The create-session response names it: 'aws' for a presigned POST form, absent for a backend URL.

import type { SessionUploadInfo } from '../types/session';

export const AWS_STORAGE_PROVIDER = 'aws';
export const BACKEND_STORAGE_PROVIDER = 'backend';

// A usable upload payload: a non-empty endpoint string, or a presigned-form object.
export function hasUploadPayload(upload: unknown): upload is SessionUploadInfo {
  if (typeof upload === 'string') {
    return upload.trim().length > 0;
  }
  return typeof upload === 'object' && upload !== null;
}

// Prefers the server's storage_provider; else infers from payload shape, as the server does.
export function resolveStorageProvider(
  sessionProvider: string | null | undefined,
  upload: SessionUploadInfo | undefined
): string {
  const named = typeof sessionProvider === 'string' ? sessionProvider.trim().toLowerCase() : '';
  if (named) {
    return named;
  }
  return typeof upload === 'string' ? BACKEND_STORAGE_PROVIDER : AWS_STORAGE_PROVIDER;
}
