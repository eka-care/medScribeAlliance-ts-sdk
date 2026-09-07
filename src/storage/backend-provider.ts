// BackendStorageProvider — uploads audio to the Eka backend instead of direct-to-S3.
// The upload_url is a plain endpoint string; the filename is appended as a path segment.
// POST {upload_url}/{fileName} with the audio in a multipart "file" field.
// Content-Type is set explicitly to an audio/* value, matching the request the backend
// team verified. Setting it means fetch does NOT append a boundary, so the server reads
// the whole envelope as the raw body — the same shape their `curl --form` produces.
// Unlike the presigned S3 path this is a first-party call, so it carries service auth.

import * as z from 'zod';
import { UploadError } from '../utils/errors';
import type { StorageProvider, UploadContext, PreparedUpload } from './storage-provider.interface';

const BackendUploadSchema = z.string().trim().min(1, 'upload_url is required');

const FILE_FIELD_NAME = 'file';

// The endpoint only checks this starts with 'audio/' and is on its allowlist; it does not
// have to describe the actual codec. Matches the backend team's verified request.
const UPLOAD_CONTENT_TYPE = 'audio/webm;codecs=opus';

export class BackendStorageProvider implements StorageProvider {
  readonly name = 'backend';

  prepareUpload({ fileName, upload }: UploadContext): PreparedUpload {
    const parsed = BackendUploadSchema.safeParse(upload);

    if (!parsed.success) {
      throw new UploadError(
        `Invalid backend upload payload: expected an upload_url string, got ${typeof upload}`,
        [fileName]
      );
    }

    const baseUrl = parsed.data.replace(/\/+$/, '');

    return {
      url: `${baseUrl}/${encodeURIComponent(fileName)}`,
      method: 'POST',
      bodyMode: 'multipart',
      fileFieldName: FILE_FIELD_NAME,
      headers: { 'Content-Type': UPLOAD_CONTENT_TYPE },
      attachAuth: true,
    };
  }
}
