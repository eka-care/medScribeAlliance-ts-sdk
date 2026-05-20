/**
 * SessionManager — handles session lifecycle via transport.
 *
 * - createSession()      — POST /sessions
 * - endSession()         — POST /sessions/{id}/end
 * - getSessionStatus()   — GET /sessions/{id}
 * - patchSession()       — PATCH /sessions/{id}
 * - processTemplate()    — POST /sessions/{id}/process/template/{template_id}
 * - pollForCompletion()  — polls getSessionStatus until terminal state
 *
 * All requests and responses are validated through the Validator.
 */

import {
  ITransport,
  CreateSessionRequest,
  CreateSessionResponse,
  EndSessionRequest,
  EndSessionResponse,
  GetSessionStatusResponse,
  PollOptions,
  PatchSessionRequest,
  PatchSessionResponse,
  ProcessTemplateResponse,
  ApiCallResult,
} from '../types';
import { SessionStatus, DEFAULT_POLL_MAX_ATTEMPTS, DEFAULT_POLL_INTERVAL_MS } from '../constants';
import { Validator } from '../validation/validator';
import { ScribeError } from '../utils/errors';

export class SessionManager {
  private transport: ITransport;
  private validator: Validator;
  private debug: boolean;

  private currentSession: CreateSessionResponse | null = null;

  constructor(transport: ITransport, validator: Validator, debug: boolean = false) {
    this.transport = transport;
    this.validator = validator;
    this.debug = debug;
  }

  // TODO: session-id is created by server not client
  /**
   * Create a new scribe session.
   * Validates the request structure, sends to server, validates response.
   */
  async createSession(
    baseUrl: string,
    request: CreateSessionRequest
  ): Promise<ApiCallResult<CreateSessionResponse>> {
    try {
      this.validator.validateCreateSessionRequest(request);

      const url = `${baseUrl}/sessions`;

      if (this.debug) {
        console.log('[ScribeSDK] Creating session:', url);
      }

      const response = await this.transport.request<CreateSessionResponse>({
        method: 'POST',
        url,
        body: request,
      });

      this.validator.validateCreateSessionResponse(response.data);

      this.currentSession = response.data;

      if (this.debug) {
        console.log('[ScribeSDK] Session created:', response.data.session_id);
      }

      return { data: response.data, httpStatus: response.status };
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new ScribeError(
        `Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * End an active session.
   * If no sessionId is provided, ends the current session.
   */
  async endSession(
    baseUrl: string,
    request: EndSessionRequest,
    sessionId?: string
  ): Promise<ApiCallResult<EndSessionResponse>> {
    try {
      const id = sessionId ?? this.currentSession?.session_id;

      if (!id) {
        throw new ScribeError(
          'No active session to end. Provide a sessionId or start a session first.'
        );
      }

      this.validator.validateSessionId(id);
      this.validator.validateEndSessionRequest(request);

      const url = `${baseUrl}/sessions/${id}/end`;

      if (this.debug) {
        console.log('[ScribeSDK] Ending session:', id);
      }

      const response = await this.transport.request<EndSessionResponse>({
        method: 'POST',
        url,
        body: request,
      });

      this.validator.validateEndSessionResponse(response.data);

      // Clear current session if we just ended it
      if (this.currentSession?.session_id === id) {
        this.currentSession = null;
      }

      if (this.debug) {
        console.log('[ScribeSDK] Session ended:', id, response.data.status);
      }

      return { data: response.data, httpStatus: response.status };
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new ScribeError(
        `Failed to end session: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get the status of a session.
   * If no sessionId is provided, queries the current session.
   * Pass templateId to filter status for a specific template.
   */
  async getSessionStatus(
    baseUrl: string,
    sessionId?: string,
    templateId?: string
  ): Promise<ApiCallResult<GetSessionStatusResponse>> {
    try {
      const id = sessionId ?? this.currentSession?.session_id;

      if (!id) {
        throw new ScribeError('No active session. Provide a sessionId or start a session first.');
      }

      this.validator.validateSessionId(id);

      let url = `${baseUrl}/sessions/${id}`;
      if (templateId) {
        url += `?template_id=${encodeURIComponent(templateId)}`;
      }

      if (this.debug) {
        console.log('[ScribeSDK] Getting session status:', id);
      }

      const response = await this.transport.request<GetSessionStatusResponse>({
        method: 'GET',
        url,
        acceptStatuses: [410], // 410 returns ExpiredSessionResponse — valid data, not an error
      });

      this.validator.validateGetSessionStatusResponse(response.data);

      if (this.debug) {
        console.log('[ScribeSDK] Session status:', id, response.data.status);
      }

      return { data: response.data, httpStatus: response.status };
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new ScribeError(
        `Failed to get session status: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Patch an existing session (e.g., update user_status or processing_status).
   */
  async patchSession(
    baseUrl: string,
    request: PatchSessionRequest,
    sessionId?: string
  ): Promise<ApiCallResult<PatchSessionResponse>> {
    try {
      const id = sessionId ?? this.currentSession?.session_id;

      if (!id) {
        throw new ScribeError('No active session. Provide a sessionId or start a session first.');
      }

      this.validator.validateSessionId(id);
      this.validator.validatePatchSessionRequest(request);

      const url = `${baseUrl}/sessions/${id}`;

      if (this.debug) {
        console.log('[ScribeSDK] Patching session:', id, request);
      }

      const response = await this.transport.request<PatchSessionResponse>({
        method: 'PATCH',
        url,
        body: request,
      });

      this.validator.validatePatchSessionResponse(response.data);

      if (this.debug) {
        console.log('[ScribeSDK] Session patched:', id, response.data.status);
      }

      return { data: response.data, httpStatus: response.status };
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new ScribeError(
        `Failed to patch session: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Trigger processing for a specific template in a session.
   */
  async processTemplate(
    baseUrl: string,
    templateId: string,
    sessionId?: string
  ): Promise<ApiCallResult<ProcessTemplateResponse>> {
    try {
      const id = sessionId ?? this.currentSession?.session_id;

      if (!id) {
        throw new ScribeError('No active session. Provide a sessionId or start a session first.');
      }

      this.validator.validateSessionId(id);

      const url = `${baseUrl}/sessions/${id}/process/template/${encodeURIComponent(templateId)}`;

      if (this.debug) {
        console.log('[ScribeSDK] Processing template:', templateId, 'for session:', id);
      }

      const response = await this.transport.request<ProcessTemplateResponse>({
        method: 'POST',
        url,
      });

      this.validator.validateProcessTemplateResponse(response.data);

      if (this.debug) {
        console.log('[ScribeSDK] Template processing triggered:', templateId, response.data.status);
      }

      return { data: response.data, httpStatus: response.status };
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new ScribeError(
        `Failed to process template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Poll for session completion.
   * Keeps checking getSessionStatus until the session reaches a terminal state
   * (completed, partial, or failed) or the max attempts are exhausted.
   */
  async pollForCompletion(
    baseUrl: string,
    sessionId?: string,
    options?: PollOptions
  ): Promise<ApiCallResult<GetSessionStatusResponse>> {
    try {
      const id = sessionId ?? this.currentSession?.session_id;

      if (!id) {
        throw new ScribeError('No active session. Provide a sessionId or start a session first.');
      }

      const maxAttempts = options?.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
      const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

      if (this.debug) {
        console.log('[ScribeSDK] Polling for completion:', id, { maxAttempts, intervalMs });
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Check for abort before each attempt
        if (options?.signal?.aborted) {
          throw new ScribeError(
            'Polling was aborted',
            'polling_aborted',
            undefined,
            { session_id: id }
          );
        }

        const statusResult = await this.getSessionStatus(baseUrl, id);
        const status = statusResult.data;

        // Notify progress callback
        if (options?.onProgress) {
          try {
            options.onProgress(status);
          } catch (error) {
            console.error('[ScribeSDK] Error in poll onProgress callback:', error);
          }
        }

        // Check for terminal states
        if (this.isTerminalStatus(status.status)) {
          if (this.debug) {
            console.log('[ScribeSDK] Poll complete:', id, status.status, `(attempt ${attempt})`);
          }
          return statusResult;
        }

        // Wait before next poll (skip wait on last attempt)
        if (attempt < maxAttempts) {
          await this.sleepWithAbort(intervalMs, options?.signal);
        }
      }

      throw new ScribeError(
        `Polling timed out after ${maxAttempts} attempts for session '${id}'`,
        'polling_timeout',
        undefined,
        { session_id: id, max_attempts: maxAttempts }
      );
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }
      throw new ScribeError(
        `Failed to poll session: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get the current active session, if any.
   */
  getCurrentSession(): CreateSessionResponse | null {
    return this.currentSession;
  }

  /**
   * Clear the current session reference.
   * Used when recording is stopped or session is explicitly cleared.
   */
  clearCurrentSession(): void {
    this.currentSession = null;
  }

  /**
   * Check if a session status is terminal (no more processing will happen).
   */
  private isTerminalStatus(status: string): boolean {
    return (
      status === SessionStatus.COMPLETED ||
      status === SessionStatus.PARTIAL ||
      status === SessionStatus.FAILED ||
      status === SessionStatus.EXPIRED
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Sleep that can be interrupted by an AbortSignal.
   */
  private sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return this.sleep(ms);
    }
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new ScribeError('Polling was aborted', 'polling_aborted'));
        return;
      }
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new ScribeError('Polling was aborted', 'polling_aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
