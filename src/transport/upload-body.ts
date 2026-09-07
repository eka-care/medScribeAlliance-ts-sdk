// One multipart rule for every transport: bodyMode wins, form fields are the legacy fallback.

import type { TransportRequest } from '../types/transport';

export function isMultipartUpload(config: TransportRequest): boolean {
  if (config.uploadBodyMode) {
    return config.uploadBodyMode === 'multipart';
  }
  return Boolean(config.uploadFormFields);
}
