/**
 * ScribeClient — thin facade for the MedScribe Alliance TS SDK.
 *
 * All public async methods return SDKResult<T> — expected errors
 * (API failures, auth, validation, mic denied) are returned, not thrown.
 * Only programmer errors (bad config at construction) throw.
 *
 * This class does NOT contain business logic — it delegates to:
 * - DiscoveryManager  (discovery + resolved config)
 * - SessionManager    (session CRUD + polling)
 * - RecordingManager  (recorder lifecycle + upload orchestration)
 * - CallbackRegistry  (typed event dispatch)
 * - Validator         (schema + discovery-driven validation)
 * - ITransport        (HTTP or IPC, decided at construction)
 */

import type {
  ScribeSDKConfig,
  RecordingOptions,
  CreateSessionResponse,
  GetSessionStatusResponse,
  PollOptions,
  DiscoveryDocument,
  ResolvedConfig,
  CallbackMap,
  CallbackName,
  CreateSessionRequest,
  SDKResult,
} from './types';
import { TransportMode } from './constants';
import { ScribeError, ValidationError } from './utils/errors';
import { CallbackRegistry } from './callbacks/callback-registry';
import { Validator } from './validation/validator';
import { HttpTransport } from './transport/http-transport';
import { IpcTransport } from './transport/ipc-transport';
import type { ITransport } from './types/transport';
import { DiscoveryManager } from './discovery/discovery-manager';
import { SessionManager } from './session/session-manager';
import { RecordingManager } from './recording/recording-manager';
import type { StopRecordingResult } from './types/recording';

export class ScribeClient {
  private config: ScribeSDKConfig;
  private transport: ITransport;
  private callbackRegistry: CallbackRegistry;
  private validator: Validator;
  private discoveryManager: DiscoveryManager;
  private sessionManager: SessionManager;
  private recordingManager: RecordingManager;

  private isInitialized: boolean = false;

  constructor(config: ScribeSDKConfig) {
    this.validateConfig(config);

    this.config = {
      debug: false,
      autoDiscovery: true,
      mode: TransportMode.DIRECT,
      ...config,
    };

    // 1. Create shared infrastructure (before transport — transport needs onUnauthorized callback)
    this.callbackRegistry = new CallbackRegistry();
    this.validator = new Validator();

    // 2. Create transport based on mode
    this.transport = this.createTransport();

    // 3. Create managers
    this.discoveryManager = new DiscoveryManager(this.transport, this.validator, this.config.debug);

    this.sessionManager = new SessionManager(this.transport, this.validator, this.config.debug);

    this.recordingManager = new RecordingManager(
      this.callbackRegistry,
      this.sessionManager,
      this.discoveryManager,
      this.transport,
      {
        debug: this.config.debug,
        workerConfig: this.resolveWorkerConfig(),
      }
    );
  }

  // --- Lifecycle ---

  /**
   * Initialize the SDK — fetches the discovery document if autoDiscovery is enabled.
   * Must be called before starting a recording.
   */
  async init(): Promise<SDKResult<void>> {
    if (this.isInitialized) {
      return { success: true, data: undefined };
    }

    return this.wrapResult(async () => {
      if (this.config.autoDiscovery !== false) {
        await this.discoveryManager.fetchDiscovery(this.config.baseUrl);
      }
      this.isInitialized = true;
    });
  }

  // --- Recording ---

  /**
   * Start a recording session.
   * Calls init() automatically if not already initialized.
   */
  async startRecording(options: RecordingOptions): Promise<SDKResult<CreateSessionResponse>> {
    if (!this.isInitialized) {
      const initResult = await this.init();
      if (!initResult.success) {
        return initResult;
      }
    }

    const baseUrl = this.getEffectiveBaseUrl();

    return this.wrapResult(() =>
      this.recordingManager.start(baseUrl, options, this.config.accessToken)
    );
  }

  /**
   * Pause the active recording.
   */
  pauseRecording(): void {
    this.recordingManager.pause();
  }

  /**
   * Resume a paused recording.
   */
  resumeRecording(): void {
    this.recordingManager.resume();
  }

  /**
   * End the active recording — stops recorder, waits for uploads, ends session.
   */
  async endRecording(): Promise<SDKResult<StopRecordingResult>> {
    return this.wrapResult(() => this.recordingManager.stop());
  }

  /**
   * Check if a recording is currently active.
   */
  isRecording(): boolean {
    return this.recordingManager.isRecording();
  }

  /**
   * Check if the active recording is paused.
   */
  isRecordingPaused(): boolean {
    return this.recordingManager.isPaused();
  }

  // --- Session ---

  /**
   * Create a session directly (without starting a recording).
   */
  async createSession(sessionRequest: CreateSessionRequest): Promise<SDKResult<CreateSessionResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    return this.wrapResult(() =>
      this.sessionManager.createSession(baseUrl, sessionRequest)
    );
  }

  /**
   * Get the status of a session.
   * Uses the current active session if no sessionId is provided.
   */
  async getSessionStatus(sessionId?: string): Promise<SDKResult<GetSessionStatusResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    return this.wrapResult(() =>
      this.sessionManager.getSessionStatus(baseUrl, sessionId)
    );
  }

  /**
   * Poll for session completion — keeps checking until terminal state or timeout.
   */
  async pollForCompletion(
    sessionId?: string,
    options?: PollOptions
  ): Promise<SDKResult<GetSessionStatusResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    return this.wrapResult(() =>
      this.sessionManager.pollForCompletion(baseUrl, sessionId, options)
    );
  }

  /**
   * Get the current active session, if any.
   */
  getCurrentSession(): CreateSessionResponse | null {
    return this.recordingManager.getActiveSession() ?? this.sessionManager.getCurrentSession();
  }

  // --- Discovery ---

  /**
   * Get the resolved discovery config.
   * Returns error if discovery hasn't been fetched yet.
   */
  getDiscoveryConfig(): SDKResult<ResolvedConfig> {
    try {
      return { success: true, data: this.discoveryManager.getResolvedConfig() };
    } catch (error) {
      return { success: false, error: this.toScribeError(error) };
    }
  }

  /**
   * Get the raw discovery document.
   */
  getDiscoveryDocument(): DiscoveryDocument | null {
    return this.discoveryManager.getDiscoveryDocument();
  }

  /**
   * Force refresh the discovery document.
   */
  async refreshDiscovery(): Promise<SDKResult<ResolvedConfig>> {
    return this.wrapResult(() =>
      this.discoveryManager.fetchDiscovery(this.config.baseUrl, true)
    );
  }

  // --- Callbacks ---

  /**
   * Register a callback handler.
   *
   * @example
   * client.registerCallback('onAudioEvent', (event) => {
   *   if (event.type === 'user_speech') console.log('Speaking:', event.data.isSpeaking);
   * });
   */
  registerCallback<K extends CallbackName>(name: K, handler: CallbackMap[K]): void {
    this.callbackRegistry.register(name, handler);
  }

  /**
   * Remove a previously registered callback handler.
   */
  removeCallback<K extends CallbackName>(name: K, handler: CallbackMap[K]): void {
    this.callbackRegistry.remove(name, handler);
  }

  // --- Auth ---

  /**
   * Update the Bearer token. Propagates to transport, active recorder, and worker.
   */
  setAccessToken(token: string): void {
    this.config.accessToken = token;
    this.transport.setAuthToken(token);
    this.recordingManager.updateAuthToken(token);
  }

  /**
   * Update the API key.
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
    this.transport.setApiKey(apiKey);
  }

  // --- Reset ---

  /**
   * Full reset — stops recording if active, clears all caches and state.
   */
  async reset(): Promise<void> {
    try {
      if (this.recordingManager.isRecording()) {
        await this.recordingManager.stop();
      }
    } catch {
      // Best-effort stop
    }

    this.recordingManager.reset();
    this.sessionManager.clearCurrentSession();
    this.discoveryManager.clearCache();
    this.callbackRegistry.removeAll();
    this.isInitialized = false;
  }

  // --- Private ---

  /**
   * Wraps an async operation into SDKResult.
   * Internal layers throw — this converts to { success, data/error }.
   */
  private async wrapResult<T>(fn: () => Promise<T>): Promise<SDKResult<T>> {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: this.toScribeError(error) };
    }
  }

  /**
   * Ensures any error is a ScribeError instance.
   */
  private toScribeError(error: unknown): ScribeError {
    if (error instanceof ScribeError) {
      return error;
    }
    return new ScribeError(
      error instanceof Error ? error.message : 'Unknown error'
    );
  }

  private createTransport(): ITransport {
    const onUnauthorized = () => {
      this.callbackRegistry.dispatch('onTokenRequired', {
        resolve: (newToken: string) => {
          this.setAccessToken(newToken);
        },
      });
    };

    if (this.config.mode === TransportMode.IPC) {
      if (!this.config.ipcTransport) {
        throw new ValidationError('ipcTransport (IpcBridge) is required when mode is "ipc"');
      }
      return new IpcTransport({
        bridge: this.config.ipcTransport,
        apiKey: this.config.apiKey,
        accessToken: this.config.accessToken,
        debug: this.config.debug,
        onUnauthorized,
      });
    }

    return new HttpTransport({
      apiKey: this.config.apiKey,
      accessToken: this.config.accessToken,
      debug: this.config.debug,
      onUnauthorized,
    });
  }

  private resolveWorkerConfig() {
    const useWorker = this.config.useWorker ?? 'auto';

    // IPC mode should never use SharedWorker (worker can't access IPC bridge)
    if (this.config.mode === TransportMode.IPC) {
      return { forceMainThread: true };
    }

    if (useWorker === false) {
      return { forceMainThread: true };
    }

    // 'auto' or true — let WorkerManager decide based on SharedWorker availability
    return {
      forceMainThread: false,
    };
  }

  /**
   * Get the effective base URL — prefer discovery's base_url, fall back to config.
   */
  private getEffectiveBaseUrl(): string {
    try {
      const resolved = this.discoveryManager.getResolvedConfig();
      return resolved.baseUrl;
    } catch {
      return this.config.baseUrl;
    }
  }

  private validateConfig(config: ScribeSDKConfig): void {
    if (!config.baseUrl) {
      throw new ValidationError('baseUrl is required');
    }
  }
}
