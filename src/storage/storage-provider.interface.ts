/**
 * Storage provider abstraction — the only part of the upload flow that varies
 * between backends (AWS S3, GCP, ...). A provider is a pure, DOM-free request
 * builder so it runs on the main thread, in the SharedWorker, and over IPC.
 *
 * To add a provider: implement StorageProvider in `<name>-provider.ts` and
 * register it in `storage-provider-factory.ts`. No other changes needed.
 */

export interface UploadContext {
  fileName: string;
  blob: Blob;
  upload: unknown;
}

export interface PreparedUpload {
  url: string;
  method: 'POST' | 'PUT';
  bodyMode: 'multipart' | 'binary';
  formFields?: Record<string, string>;
  fileFieldName?: string;
  headers: Record<string, string>;
  attachAuth: boolean;
}

export interface StorageProvider {
  /** Matches discovery's `capabilities.storage_provider`. */
  readonly name: string;
  /** @throws UploadError if the upload payload is malformed. */
  prepareUpload(ctx: UploadContext): PreparedUpload;
}
