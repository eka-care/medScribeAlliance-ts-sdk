// One rule for "is this upload multipart", shared by every transport.
// PreparedUpload.bodyMode is authoritative; the form-fields check is the legacy fallback
// for callers that build a TransportRequest by hand. Keying off formFields alone is wrong:
// a file-only multipart (backend audio upload) has no fields and would look binary.

import type { TransportRequest } from '../types/transport';

export function isMultipartUpload(config: TransportRequest): boolean {
  if (config.uploadBodyMode) {
    return config.uploadBodyMode === 'multipart';
  }
  return Boolean(config.uploadFormFields);
}
