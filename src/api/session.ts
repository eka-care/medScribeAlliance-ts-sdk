/**
 * Session API
 * Implements Session Lifecycle endpoints (Spec 06)
 */

import {
  CreateSessionRequest,
  CreateSessionResponse,
  EndSessionResponse,
  GetSessionStatusResponse,
} from '../types';
import { HttpClient } from './base';
import { schemaValidator } from '../utils/validator';

export class SessionAPI {
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(httpClient: HttpClient, baseUrl: string) {
    this.httpClient = httpClient;
    this.baseUrl = baseUrl;
  }

  /**
   * Update the base URL (e.g., after discovery)
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /**
   * Create a new session
   * POST /sessions
   *
   * @param request - Session creation parameters
   * @returns Session creation response with session_id and upload_url
   */
  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    // Validate request against schema
    schemaValidator.validateCreateSessionRequest(request);

    const url = `${this.baseUrl}/sessions`;
    return this.httpClient.post<CreateSessionResponse>(url, request);
  }

  /**
   * Get session status
   * GET /sessions/{sessionId}
   *
   * @param sessionId - The session ID
   * @returns Current session status and results (if available)
   */
  async getSessionStatus(sessionId: string): Promise<GetSessionStatusResponse> {
    // Validate session ID format
    schemaValidator.validateSessionId(sessionId);

    const url = `${this.baseUrl}/sessions/${sessionId}`;
    return this.httpClient.get<GetSessionStatusResponse>(url);
  }

  /**
   * End a session
   * POST /sessions/{sessionId}/end
   *
   * This triggers processing of the uploaded audio.
   * No more audio can be uploaded after this call.
   *
   * @param sessionId - The session ID
   * @param audioFilesSent - Number of audio files sent during the session
   * @returns End session response with processing status
   */
  async endSession(sessionId: string, audioFilesSent?: number): Promise<EndSessionResponse> {
    const url = `${this.baseUrl}/sessions/${sessionId}/end`;
    const body = audioFilesSent !== undefined ? { audio_files_sent: audioFilesSent } : undefined;
    return this.httpClient.post<EndSessionResponse>(url, body);
  }

  /**
   * Poll for session completion
   * Repeatedly checks session status until it's completed, partial, or failed
   *
   * @param sessionId - The session ID
   * @param options - Polling options
   * @returns Final session status
   */
  async pollSessionStatus(
    sessionId: string,
    options: {
      maxAttempts?: number;
      intervalMs?: number;
      onProgress?: (status: GetSessionStatusResponse) => void;
    } = {}
  ): Promise<GetSessionStatusResponse> {
    const {
      maxAttempts = 60, // Default: 60 attempts
      intervalMs = 2000, // Default: 2 seconds
      onProgress,
    } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getSessionStatus(sessionId);

      if (onProgress) {
        onProgress(status);
      }

      // Check if processing is complete
      if (
        status.status === 'completed' ||
        status.status === 'partial' ||
        status.status === 'failed'
      ) {
        return status;
      }

      // Wait before next poll
      if (attempt < maxAttempts - 1) {
        await this.sleep(intervalMs);
      }
    }

    // Max attempts reached
    throw new Error(
      `Polling timeout: session ${sessionId} did not complete after ${maxAttempts} attempts`
    );
  }

  /**
   * Helper function to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
