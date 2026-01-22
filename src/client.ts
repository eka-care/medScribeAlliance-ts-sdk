/**
 * Scribe SDK Client
 * Main entry point for the Scribe EMR Protocol SDK
 */

import { DiscoveryAPI } from './api/discovery';
import { SessionAPI } from './api/session';
import { HttpClient } from './api/base';
import { EventEmitter } from './utils/events';
import { ValidationError } from './utils/errors';
import {
  ScribeSDKConfig,
  RecordingOptions,
  DiscoveryDocument,
  CreateSessionResponse,
  GetSessionStatusResponse,
  EndSessionResponse,
  SDKEvent,
  SDKEventType,
} from './types';
import { SessionStatus } from './constants';

export class ScribeClient {
  private config: ScribeSDKConfig;
  private httpClient: HttpClient;
  private discoveryAPI: DiscoveryAPI;
  private sessionAPI: SessionAPI;
  private eventEmitter: EventEmitter;

  private discoveryDocument: DiscoveryDocument | null = null;
  private currentSession: CreateSessionResponse | null = null;
  private isInitialized: boolean = false;

  constructor(config: ScribeSDKConfig) {
    this.validateConfig(config);
    this.config = {
      debug: false,
      autoDiscovery: true,
      ...config,
    };

    this.httpClient = new HttpClient(this.config.apiKey, this.config.debug);
    this.discoveryAPI = new DiscoveryAPI(this.httpClient);
    this.sessionAPI = new SessionAPI(
      this.httpClient,
      this.config.baseUrl || '' // Will be set after discovery
    );
    this.eventEmitter = new EventEmitter();
  }

  /**
   * Initialize the SDK
   * Performs service discovery if autoDiscovery is enabled
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      if (this.config.debug) {
        console.log('[ScribeSDK] Already initialized');
      }
      return;
    }

    if (!this.config.baseUrl) {
      throw new ValidationError('baseUrl is required for initialization');
    }

    if (this.config.autoDiscovery) {
      try {
        this.discoveryDocument = await this.discoveryAPI.getDiscovery(this.config.baseUrl);

        // Update base URL from discovery
        if (this.discoveryDocument.endpoints.base_url) {
          this.sessionAPI.setBaseUrl(this.discoveryDocument.endpoints.base_url);
        }

        this.emitEvent({
          type: 'discovery:complete',
          data: this.discoveryDocument,
        });

        if (this.config.debug) {
          console.log('[ScribeSDK] Discovery complete:', this.discoveryDocument);
        }
      } catch (error) {
        this.emitEvent({
          type: 'error',
          error: error instanceof Error ? error : new Error('Discovery failed'),
        });
        throw error;
      }
    } else {
      // If auto-discovery is disabled, use the provided baseUrl
      this.sessionAPI.setBaseUrl(this.config.baseUrl);
    }

    this.isInitialized = true;
  }

  /**
   * Start a recording session
   * Creates a new session and returns session information
   * 
   * Note: Audio upload is handled separately (assumed to be done externally)
   */
  async startRecording(options: RecordingOptions): Promise<CreateSessionResponse> {
    if (!this.isInitialized) {
      await this.init();
    }

    this.validateRecordingOptions(options);

    try {
      // Create session request
      const request = {
        templates: options.templates,
        model: options.model,
        language_hint: options.languageHint,
        transcript_language: options.transcriptLanguage,
        upload_type: options.uploadType,
        additional_data: options.additionalData,
      };

      // Create the session
      this.currentSession = await this.sessionAPI.createSession(request);

      this.emitEvent({
        type: 'session:created',
        data: this.currentSession,
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Session created:', this.currentSession);
      }

      return this.currentSession;
    } catch (error) {
      this.emitEvent({
        type: 'error',
        error: error instanceof Error ? error : new Error('Failed to start recording'),
      });
      throw error;
    }
  }

  /**
   * End the current recording session
   * Triggers processing of uploaded audio
   */
  async endRecording(): Promise<EndSessionResponse> {
    if (!this.currentSession) {
      throw new ValidationError('No active session to end');
    }

    try {
      const response = await this.sessionAPI.endSession(this.currentSession.session_id);

      this.emitEvent({
        type: 'session:ended',
        data: response,
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Session ended:', response);
      }

      return response;
    } catch (error) {
      this.emitEvent({
        type: 'error',
        error: error instanceof Error ? error : new Error('Failed to end recording'),
      });
      throw error;
    }
  }

  /**
   * Get the output status of a session
   * 
   * @param sessionId - Optional session ID. Uses current session if not provided.
   */
  async getOutputStatus(sessionId?: string): Promise<GetSessionStatusResponse> {
    const targetSessionId = sessionId || this.currentSession?.session_id;

    if (!targetSessionId) {
      throw new ValidationError('No session ID provided and no active session');
    }

    try {
      const status = await this.sessionAPI.getSessionStatus(targetSessionId);

      this.emitEvent({
        type: 'session:status_update',
        data: status,
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Session status:', status);
      }

      return status;
    } catch (error) {
      this.emitEvent({
        type: 'error',
        error: error instanceof Error ? error : new Error('Failed to get output status'),
      });
      throw error;
    }
  }

  /**
   * Poll for session completion
   * Continuously checks status until processing is complete
   * 
   * @param sessionId - Optional session ID. Uses current session if not provided.
   * @param options - Polling configuration
   */
  async pollForCompletion(
    sessionId?: string,
    options: {
      maxAttempts?: number;
      intervalMs?: number;
      onProgress?: (status: GetSessionStatusResponse) => void;
    } = {}
  ): Promise<GetSessionStatusResponse> {
    const targetSessionId = sessionId || this.currentSession?.session_id;

    if (!targetSessionId) {
      throw new ValidationError('No session ID provided and no active session');
    }

    return this.sessionAPI.pollSessionStatus(targetSessionId, {
      ...options,
      onProgress: (status) => {
        this.emitEvent({
          type: 'session:status_update',
          data: status,
        });
        if (options.onProgress) {
          options.onProgress(status);
        }
      },
    });
  }

  /**
   * Get the current session information
   */
  getCurrentSession(): CreateSessionResponse | null {
    return this.currentSession;
  }

  /**
   * Get the discovery document
   */
  getDiscoveryDocument(): DiscoveryDocument | null {
    return this.discoveryDocument;
  }

  /**
   * Register an event listener
   */
  on(eventType: SDKEventType, listener: (event: SDKEvent) => void): void {
    this.eventEmitter.on(eventType, listener);
  }

  /**
   * Unregister an event listener
   */
  off(eventType: SDKEventType, listener: (event: SDKEvent) => void): void {
    this.eventEmitter.off(eventType, listener);
  }

  /**
   * Clear the current session
   */
  clearSession(): void {
    this.currentSession = null;
  }

  /**
   * Reset the SDK (clear session and discovery cache)
   */
  reset(): void {
    this.currentSession = null;
    this.discoveryAPI.clearCache();
    this.discoveryDocument = null;
    this.isInitialized = false;
  }

  // Private helper methods

  private validateConfig(config: ScribeSDKConfig): void {
    if (!config.apiKey) {
      throw new ValidationError('apiKey is required');
    }
  }

  private validateRecordingOptions(options: RecordingOptions): void {
    if (!options.templates || options.templates.length === 0) {
      throw new ValidationError('At least one template is required');
    }

    // Validate against discovery document if available
    if (this.discoveryDocument) {
      // Check if model is supported
      if (options.model) {
        const modelExists = this.discoveryDocument.models.some((m) => m.id === options.model);
        if (!modelExists) {
          throw new ValidationError(`Model '${options.model}' is not supported`);
        }
      }

      // Check if language hint is supported
      if (options.languageHint) {
        const langSupported = this.discoveryDocument.languages.supported.includes(
          options.languageHint
        );
        if (!langSupported) {
          throw new ValidationError(`Language '${options.languageHint}' is not supported`);
        }
      }
    }
  }

  private emitEvent(event: SDKEvent): void {
    this.eventEmitter.emit(event);
  }
}
