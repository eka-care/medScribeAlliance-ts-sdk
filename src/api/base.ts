/**
 * HTTP Client for Scribe API
 * Handles all HTTP communication with the Scribe service
 */

import { HttpStatus } from '../constants';
import { ErrorResponse } from '../types';
import { ScribeError } from '../utils/errors';

export interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}

export class HttpClient {
  private apiKey?: string;
  private debug: boolean;
  private accessToken?: string;

  constructor(apiKey?: string, accessToken?: string, debug: boolean = false) {
    this.apiKey = apiKey;
    this.debug = debug;
    this.accessToken = accessToken;
  }

  /**
   * Make an HTTP request
   */
  async request<T>(url: string, config: RequestConfig): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.headers,
    };

    // Add API key header if provided
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const requestInit: RequestInit = {
      method: config.method,
      headers,
      // Include cookies for authentication when API key is not provided
      credentials: 'include',
    };

    if (config.body) {
      requestInit.body = JSON.stringify(config.body);
    }

    if (this.debug) {
      console.log('[ScribeSDK] Request:', {
        url,
        method: config.method,
        headers,
        body: config.body,
      });
    }

    try {
      const response = await fetch(url, requestInit);

      if (this.debug) {
        console.log('[ScribeSDK] Response:', {
          status: response.status,
          statusText: response.statusText,
        });
      }

      // Handle successful responses
      if (response.ok) {
        const data = await response.json();
        return data as T;
      }

      // Handle error responses
      await this.handleErrorResponse(response);

      // This line should never be reached, but TypeScript needs it
      throw new ScribeError('Unexpected error occurred');
    } catch (error) {
      if (error instanceof ScribeError) {
        throw error;
      }

      // Network or parsing errors
      throw new ScribeError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'network_error'
      );
    }
  }

  /**
   * Handle error responses from the API
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: ErrorResponse | null = null;

    try {
      errorData = await response.json();
    } catch {
      // If response is not JSON, create a generic error
      throw new ScribeError(
        `HTTP ${response.status}: ${response.statusText}`,
        'http_error',
        response.status
      );
    }

    if (errorData?.error) {
      throw ScribeError.fromApiError(errorData.error, response.status);
    }

    // Fallback error
    throw new ScribeError(
      `HTTP ${response.status}: ${response.statusText}`,
      'http_error',
      response.status
    );
  }

  /**
   * GET request
   */
  async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(url, { method: 'GET', headers });
  }

  /**
   * POST request
   */
  async post<T>(url: string, body?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(url, { method: 'POST', body, headers });
  }

  /**
   * PUT request
   */
  async put<T>(url: string, body?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(url, { method: 'PUT', body, headers });
  }

  /**
   * PATCH request
   */
  async patch<T>(url: string, body?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(url, { method: 'PATCH', body, headers });
  }

  /**
   * DELETE request
   */
  async delete<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(url, { method: 'DELETE', headers });
  }
}
