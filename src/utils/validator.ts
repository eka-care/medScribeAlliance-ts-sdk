/**
 * Schema Validator with basic validations
 * Validates API requests without using eval-based libraries (CSP compatible)
 */

import { ValidationError } from './errors';

// Valid enum values
const VALID_MODELS = ['pro', 'lite'];
const VALID_UPLOAD_TYPES = ['chunked', 'single', 'stream'];
const VALID_COMMUNICATION_PROTOCOLS = ['websocket', 'http', 'rpc'];
const SESSION_ID_PATTERN = /^ses_[a-zA-Z0-9]+$/;

interface CreateSessionRequestData {
  templates?: unknown;
  model?: unknown;
  language_hint?: unknown;
  transcript_language?: unknown;
  upload_type?: unknown;
  communication_protocol?: unknown;
  additional_data?: unknown;
}

class SchemaValidator {
  /**
   * Validate CreateSessionRequest
   */
  validateCreateSessionRequest(data: unknown): void {
    if (!data || typeof data !== 'object') {
      throw new ValidationError('CreateSessionRequest must be an object');
    }

    const request = data as CreateSessionRequestData;
    const errors: string[] = [];

    // Required fields
    if (!request.templates) {
      errors.push('templates is required');
    }
    if (!request.upload_type) {
      errors.push('upload_type is required');
    }
    if (!request.communication_protocol) {
      errors.push('communication_protocol is required');
    }

    // Validate templates
    if (request.templates !== undefined) {
      if (!Array.isArray(request.templates)) {
        errors.push('templates must be an array');
      } else {
        if (request.templates.length > 2) {
          errors.push('templates cannot have more than 2 items');
        }
        request.templates.forEach((item, index) => {
          if (typeof item !== 'string') {
            errors.push(`templates[${index}] must be a string`);
          }
        });
      }
    }

    // Validate model (optional)
    if (request.model !== undefined) {
      if (typeof request.model !== 'string' || !VALID_MODELS.includes(request.model)) {
        errors.push(`model must be one of: ${VALID_MODELS.join(', ')}`);
      }
    }

    // Validate language_hint (optional)
    if (request.language_hint !== undefined) {
      if (!Array.isArray(request.language_hint)) {
        errors.push('language_hint must be an array');
      } else {
        request.language_hint.forEach((item, index) => {
          if (typeof item !== 'string') {
            errors.push(`language_hint[${index}] must be a string`);
          } else if (item.length > 2) {
            errors.push(`language_hint[${index}] must be at most 2 characters`);
          }
        });
      }
    }

    // Validate transcript_language (optional)
    if (request.transcript_language !== undefined) {
      if (!Array.isArray(request.transcript_language)) {
        errors.push('transcript_language must be an array');
      } else {
        request.transcript_language.forEach((item, index) => {
          if (typeof item !== 'string') {
            errors.push(`transcript_language[${index}] must be a string`);
          } else if (item.length > 2) {
            errors.push(`transcript_language[${index}] must be at most 2 characters`);
          }
        });
      }
    }

    // Validate upload_type
    if (request.upload_type !== undefined) {
      if (
        typeof request.upload_type !== 'string' ||
        !VALID_UPLOAD_TYPES.includes(request.upload_type)
      ) {
        errors.push(`upload_type must be one of: ${VALID_UPLOAD_TYPES.join(', ')}`);
      }
    }

    // Validate communication_protocol
    if (request.communication_protocol !== undefined) {
      if (
        typeof request.communication_protocol !== 'string' ||
        !VALID_COMMUNICATION_PROTOCOLS.includes(request.communication_protocol)
      ) {
        errors.push(
          `communication_protocol must be one of: ${VALID_COMMUNICATION_PROTOCOLS.join(', ')}`
        );
      }
    }

    // Validate additional_data (optional)
    if (request.additional_data !== undefined) {
      if (typeof request.additional_data !== 'object' || request.additional_data === null) {
        errors.push('additional_data must be an object');
      }
    }

    if (errors.length > 0) {
      throw new ValidationError(
        `Validation failed for CreateSessionRequest:\n${errors.map((e) => `  - ${e}`).join('\n')}`
      );
    }
  }

  /**
   * Validate session ID parameter
   */
  validateSessionId(sessionId: unknown): void {
    if (typeof sessionId !== 'string') {
      throw new ValidationError('Session ID must be a string');
    }

    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new ValidationError(
        'Session ID must match pattern: ses_[alphanumeric characters] (e.g., ses_abc123)'
      );
    }
  }

  /**
   * Generic validate method for backward compatibility
   */
  validate(schemaName: string, data: unknown): void {
    switch (schemaName) {
      case 'CreateSessionRequest':
        this.validateCreateSessionRequest(data);
        break;
      case 'SessionIdParam':
        this.validateSessionId(data);
        break;
      default:
        // For other schemas, just do basic type check
        if (data === undefined || data === null) {
          throw new ValidationError(`${schemaName}: data cannot be null or undefined`);
        }
    }
  }
}

// Export singleton instance
export const schemaValidator = new SchemaValidator();
