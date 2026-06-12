/**
 * Storage provider module — pluggable audio upload backends.
 */

export type { StorageProvider, UploadContext, PreparedUpload } from './storage-provider.interface';
export { AwsS3StorageProvider } from './aws-s3-provider';
export { getStorageProvider, isStorageProviderSupported } from './storage-provider-factory';
