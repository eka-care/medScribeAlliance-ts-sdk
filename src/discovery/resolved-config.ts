/**
 * ResolvedConfig — parses a validated DiscoveryDocument into a flat,
 * runtime-friendly configuration object used by all SDK layers.
 */

import { DiscoveryDocument, ResolvedConfig, ModelConfig } from '../types';
import { DiscoveryError } from '../utils/errors';

const DEFAULT_STORAGE_PROVIDER = 'aws';

function normalizeStorageProviders(capabilities: DiscoveryDocument['capabilities']): string[] {
  const cleaned = (capabilities.storage_providers ?? [])
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [DEFAULT_STORAGE_PROVIDER];
}

/**
 * Parses a validated DiscoveryDocument into a ResolvedConfig.
 * This is called once after discovery fetch + schema validation.
 */
export function resolveConfig(doc: DiscoveryDocument): ResolvedConfig {
  try {
    const maxSessionDurationSeconds = new Map<string, number>();
    const models: ModelConfig[] = doc.models ?? [];

    for (const model of models) {
      if (model.id && typeof model.max_session_duration_seconds === 'number') {
        maxSessionDurationSeconds.set(model.id, model.max_session_duration_seconds);
      }
    }

    return {
      baseUrl: doc.endpoints.base_url,
      webhooksUrl: doc.endpoints.webhooks_url,
      supportedLanguages: doc.languages?.supported ?? [],
      autoDetectLanguage: doc.languages?.auto_detection ?? false,
      supportedAudioFormats: doc.capabilities.audio_formats,
      supportedUploadMethods: doc.capabilities.upload_methods ?? [],
      storageProviders: normalizeStorageProviders(doc.capabilities),
      maxChunkDurationSeconds: doc.capabilities.max_chunk_duration_seconds,
      maxSessionDurationSeconds,
      supportedAuthMethods: doc.authentication.supported_methods,
      availableModels: models,
      webhookDelivery: doc.capabilities.webhook_delivery ?? false,
      clientSdkDelivery: doc.capabilities.client_sdk_delivery ?? false,
    };
  } catch (error) {
    if (error instanceof DiscoveryError) {
      throw error;
    }
    throw new DiscoveryError(
      `Failed to resolve discovery config: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}
