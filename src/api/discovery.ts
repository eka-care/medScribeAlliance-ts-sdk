/**
 * Discovery API
 * Implements the Discovery endpoint (Spec 04)
 */

import { WELL_KNOWN_PATH } from '../constants';
import { DiscoveryDocument } from '../types';
import { HttpClient } from './base';

export class DiscoveryAPI {
  private httpClient: HttpClient;
  private cachedDiscovery: DiscoveryDocument | null = null;
  private cacheTimestamp: number = 0;
  private cacheDuration: number = 3600 * 1000; // 1 hour in milliseconds

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Fetch discovery document from the well-known endpoint
   * Implements caching as recommended in Spec 04.8
   * 
   * @param baseUrl - The base URL of the Scribe service
   * @param forceRefresh - Force refresh the cache
   */
  async getDiscovery(baseUrl: string, forceRefresh: boolean = false): Promise<DiscoveryDocument> {
    const now = Date.now();

    // Return cached discovery if valid
    if (!forceRefresh && this.cachedDiscovery && now - this.cacheTimestamp < this.cacheDuration) {
      return this.cachedDiscovery;
    }

    // Construct well-known URL
    const discoveryUrl = new URL(WELL_KNOWN_PATH, baseUrl).toString();

    // Fetch discovery document
    const discovery = await this.httpClient.get<DiscoveryDocument>(discoveryUrl);

    // Validate protocol
    if (discovery.protocol !== 'medscribealliance') {
      throw new Error(`Invalid protocol: expected 'medscribealliance', got '${discovery.protocol}'`);
    }

    // Cache the discovery document
    this.cachedDiscovery = discovery;
    this.cacheTimestamp = now;

    return discovery;
  }

  /**
   * Clear the discovery cache
   */
  clearCache(): void {
    this.cachedDiscovery = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Get cached discovery document without making a request
   */
  getCachedDiscovery(): DiscoveryDocument | null {
    const now = Date.now();
    if (this.cachedDiscovery && now - this.cacheTimestamp < this.cacheDuration) {
      return this.cachedDiscovery;
    }
    return null;
  }
}
