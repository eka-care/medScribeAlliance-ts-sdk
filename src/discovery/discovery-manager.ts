/**
 * DiscoveryManager — fetches, validates, caches, and exposes
 * the MedScribe Alliance well-known discovery document.
 *
 * All other SDK layers read from the ResolvedConfig produced here.
 */

import {
  ITransport,
  DiscoveryDocument,
  ResolvedConfig,
  ServiceInfo,
  CapabilitiesInfo,
  ModelConfig,
  ApiCallResult,
} from '../types';
import { WELL_KNOWN_PATH, DISCOVERY_CACHE_TTL_MS } from '../constants';
import { DiscoveryError } from '../utils/errors';
import { Validator } from '../validation/validator';
import { resolveConfig } from './resolved-config';

export class DiscoveryManager {
  private transport: ITransport;
  private validator: Validator;
  private debug: boolean;

  private cachedDocument: DiscoveryDocument | null = null;
  private resolvedConfig: ResolvedConfig | null = null;
  private cacheTimestamp: number = 0;
  private cacheTtlMs: number = DISCOVERY_CACHE_TTL_MS;

  constructor(transport: ITransport, validator: Validator, debug: boolean = false) {
    this.transport = transport;
    this.validator = validator;
    this.debug = debug;
  }

  /**
   * Fetch and validate the discovery document from the well-known endpoint.
   * Caches the result for 1 hour (configurable).
   */
  async fetchDiscovery(
    baseUrl: string,
    forceRefresh: boolean = false
  ): Promise<ApiCallResult<ResolvedConfig>> {
    try {
      // Return cached config if still valid — httpStatus undefined (no HTTP call)
      if (!forceRefresh && this.resolvedConfig && this.isCacheValid()) {
        if (this.debug) {
          console.log('[ScribeSDK] Using cached discovery document');
        }
        return { data: this.resolvedConfig, httpStatus: undefined };
      }

      const discoveryUrl = baseUrl + WELL_KNOWN_PATH;

      if (this.debug) {
        console.log('[ScribeSDK] Fetching discovery from:', discoveryUrl);
      }

      const response = await this.transport.request<DiscoveryDocument>({
        method: 'GET',
        url: discoveryUrl,
      });

      // Validate response structure
      this.validator.validateDiscoveryResponse(response.data);

      // Parse into runtime config
      const doc = response.data;
      const config = resolveConfig(doc);

      // Cache
      this.cachedDocument = doc;
      this.resolvedConfig = config;
      this.cacheTimestamp = Date.now();

      if (this.debug) {
        console.log('[ScribeSDK] Discovery complete:', doc.service?.name ?? doc.protocol);
      }

      return { data: config, httpStatus: response.status };
    } catch (error) {
      if (error instanceof DiscoveryError) {
        throw error;
      }
      throw new DiscoveryError(
        `Failed to fetch discovery document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { baseUrl }
      );
    }
  }

  /**
   * Get the resolved runtime config. Throws if discovery hasn't been fetched.
   */
  getResolvedConfig(): ResolvedConfig {
    if (!this.resolvedConfig) {
      throw new DiscoveryError('Discovery has not been fetched yet. Call init() first.');
    }
    return this.resolvedConfig;
  }

  /**
   * Get the raw discovery document as received from the server.
   */
  getDiscoveryDocument(): DiscoveryDocument | null {
    return this.cachedDocument;
  }

  // --- Convenience getters ---

  getSupportedLanguages(): string[] {
    return this.getResolvedConfig().supportedLanguages;
  }

  getSupportedAudioFormats(): string[] {
    return this.getResolvedConfig().supportedAudioFormats;
  }

  getSupportedUploadMethods(): string[] {
    return this.getResolvedConfig().supportedUploadMethods;
  }

  getAvailableModels(): ModelConfig[] {
    return this.getResolvedConfig().availableModels;
  }

  getMaxChunkDuration(): number {
    return this.getResolvedConfig().maxChunkDurationSeconds;
  }

  getMaxSessionDuration(modelId?: string): number {
    const config = this.getResolvedConfig();
    if (modelId && config.maxSessionDurationSeconds.has(modelId)) {
      return config.maxSessionDurationSeconds.get(modelId)!;
    }
    // Return the max across all models if no specific model requested
    let max = 0;
    for (const duration of config.maxSessionDurationSeconds.values()) {
      if (duration > max) {
        max = duration;
      }
    }
    return max;
  }

  getServiceInfo(): ServiceInfo | undefined {
    return this.cachedDocument?.service;
  }

  getCapabilities(): CapabilitiesInfo | undefined {
    return this.cachedDocument?.capabilities;
  }

  isFeatureSupported(feature: 'realtime_transcription' | 'speaker_diarization' | 'custom_templates'): boolean {
    const models = this.getResolvedConfig().availableModels;
    return models.some((model) => model.features?.[feature] === true);
  }

  // --- Cache management ---

  clearCache(): void {
    this.cachedDocument = null;
    this.resolvedConfig = null;
    this.cacheTimestamp = 0;
  }

  private isCacheValid(): boolean {
    return Date.now() - this.cacheTimestamp < this.cacheTtlMs;
  }
}
