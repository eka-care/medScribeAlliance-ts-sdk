// BackendStorageProvider — uploads audio to the Eka backend instead of direct-to-S3.
// The upload_url is a plain endpoint string; the filename is appended as a path segment.
// POST {upload_url}/{fileName} with the raw audio as the body and an audio/* Content-Type.
// Unlike the presigned S3 path this is a first-party call, so it carries service auth.

import * as z from 'zod';
import { UploadError } from '../utils/errors';
import type { StorageProvider, UploadContext, PreparedUpload } from './storage-provider.interface';

const BackendUploadSchema = z.string().trim().min(1, 'upload_url is required');

const CONTENT_TYPE_HEADER = 'Content-Type';
const DEFAULT_CONTENT_TYPE = 'audio/mp3';

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mp3',
  webm: 'audio/webm',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
};

// The endpoint rejects a non-audio Content-Type, so fall back to the extension.
function resolveContentType(fileName: string, blob?: Blob): string {
  const blobType = blob?.type;
  if (blobType && blobType.startsWith('audio/')) {
    return blobType;
  }
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_CONTENT_TYPES[extension] ?? DEFAULT_CONTENT_TYPE;
}

export class BackendStorageProvider implements StorageProvider {
  readonly name = 'backend';

  prepareUpload({ fileName, blob, upload }: UploadContext): PreparedUpload {
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
      bodyMode: 'binary',
      headers: { [CONTENT_TYPE_HEADER]: resolveContentType(fileName, blob) },
      attachAuth: true,
    };
  }
}
