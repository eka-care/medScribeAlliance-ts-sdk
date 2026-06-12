/**
 * AwsS3StorageProvider — uploads audio to S3 via a presigned POST.
 * Sends `uploadData.fields` as form fields (file last), with `${filename}`
 * substituted into `key`. No Authorization header — the signed fields authenticate.
 */

import * as z from 'zod';
import { UploadError } from '../utils/errors';
import type { StorageProvider, UploadContext, PreparedUpload } from './storage-provider.interface';

const AwsUploadSchema = z.object({
  uploadData: z.object({
    url: z.string().min(1, 'uploadData.url is required'),
    fields: z.record(z.string(), z.string()),
  }),
  folderPath: z.string().optional(),
  txn_id: z.string().optional(),
});

const KEY_FIELD = 'key';
const FILENAME_PLACEHOLDER = '${filename}';
const CONTENT_TYPE_FIELD = 'Content-Type';
const DEFAULT_CONTENT_TYPE = 'audio/mp3';

export class AwsS3StorageProvider implements StorageProvider {
  readonly name = 'aws';

  prepareUpload({ fileName, blob, upload }: UploadContext): PreparedUpload {
    const parsed = AwsUploadSchema.safeParse(upload);

    if (!parsed.success) {
      throw new UploadError(
        `Invalid AWS upload payload in session response: ${parsed.error.message}`,
        [fileName]
      );
    }

    const { uploadData } = parsed.data;

    const formFields: Record<string, string> = {};
    for (const [field, value] of Object.entries(uploadData.fields)) {
      formFields[field] =
        field === KEY_FIELD ? value.split(FILENAME_PLACEHOLDER).join(fileName) : value;
    }

    // The signed policy requires Content-Type to start with "audio/" (read from
    // a form field, not the request header).
    if (!(CONTENT_TYPE_FIELD in formFields)) {
      const blobType = blob?.type;
      formFields[CONTENT_TYPE_FIELD] =
        blobType && blobType.startsWith('audio/') ? blobType : DEFAULT_CONTENT_TYPE;
    }

    return {
      url: uploadData.url,
      method: 'POST',
      bodyMode: 'multipart',
      formFields,
      fileFieldName: 'file',
      headers: {},
      attachAuth: false,
    };
  }
}
