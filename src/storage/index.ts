/**
 * Storage provider module — pluggable audio upload backends.
 */

export type { StorageProvider, UploadContext, PreparedUpload } from './storage-provider.interface';
export { AwsS3StorageProvider } from './aws-s3-provider';
export { BackendStorageProvider } from './backend-provider';
export {
  resolveStorageProvider,
  hasUploadPayload,
  AWS_STORAGE_PROVIDER,
  BACKEND_STORAGE_PROVIDER,
} from './resolve-provider';
export { getStorageProvider, isStorageProviderSupported } from './storage-provider-factory';
export { uploadFileToStorage } from './upload-file';
export type { UploadFileParams } from './upload-file';
