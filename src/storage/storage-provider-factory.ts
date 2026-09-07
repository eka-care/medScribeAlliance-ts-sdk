/**
 * Resolves a StorageProvider from discovery's `capabilities.storage_provider`.
 * The single place mapping a provider name to its wrapper class.
 */

import { AwsS3StorageProvider } from './aws-s3-provider';
import { UnsupportedStorageProviderError } from '../utils/errors';
import type { StorageProvider } from './storage-provider.interface';

// TODO: add other providers here, e.g. gcp: () => new GcpStorageProvider().
const PROVIDER_REGISTRY: Record<string, () => StorageProvider> = {
  aws: () => new AwsS3StorageProvider(),
};

function normalize(name: string): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

export function isStorageProviderSupported(name: string): boolean {
  return normalize(name) in PROVIDER_REGISTRY;
}

/** @throws UnsupportedStorageProviderError if no wrapper is registered. */
export function getStorageProvider(name: string): StorageProvider {
  const factory = PROVIDER_REGISTRY[normalize(name)];
  if (!factory) {
    throw new UnsupportedStorageProviderError(name);
  }
  return factory();
}
