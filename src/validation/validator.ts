/**
 * Validator — central validation class for the SDK.
 *
 * Three categories of validation:
 * 1. Schema validation    — Zod schemas for structure, types, required fields
 * 2. Response validation  — server response shape checks
 * 3. Discovery-driven     — cross-validates against server capabilities
 */

import * as z from 'zod';
import { ValidationError } from '../utils/errors';
import { ResolvedConfig, RecordingOptions } from '../types';
import { DiscoveryResponseSchema } from './schemas/discovery-schema';
import {
  CreateSessionRequestSchema,
  EndSessionRequestSchema,
  CreateSessionResponseSchema,
  EndSessionResponseSchema,
  GetSessionStatusResponseSchema,
  PatchSessionRequestSchema,
  PatchSessionResponseSchema,
  ProcessTemplateResponseSchema,
  SessionIdSchema,
} from './schemas/session-schema';
import { RecordingOptionsSchema } from './schemas/request-schema';

export class Validator {
  // --- Schema validation ---

  validateDiscoveryResponse(data: unknown): void {
    this.parseWithValidationError(DiscoveryResponseSchema, data, 'Invalid discovery response');
  }

  validateCreateSessionRequest(data: unknown): void {
    this.parseWithValidationError(CreateSessionRequestSchema, data, 'Invalid CreateSessionRequest');
  }

  validateEndSessionRequest(data: unknown): void {
    this.parseWithValidationError(EndSessionRequestSchema, data, 'Invalid EndSessionRequest');
  }

  validateCreateSessionResponse(data: unknown): void {
    this.parseWithValidationError(CreateSessionResponseSchema, data, 'Invalid CreateSessionResponse');
  }

  validateEndSessionResponse(data: unknown): void {
    this.parseWithValidationError(EndSessionResponseSchema, data, 'Invalid EndSessionResponse');
  }

  validateGetSessionStatusResponse(data: unknown): void {
    this.parseWithValidationError(GetSessionStatusResponseSchema, data, 'Invalid GetSessionStatusResponse');
  }

  validateSessionId(sessionId: unknown): void {
    this.parseWithValidationError(SessionIdSchema, sessionId, 'Invalid session ID');
  }

  validateRecordingOptions(data: unknown): void {
    this.parseWithValidationError(RecordingOptionsSchema, data, 'Invalid RecordingOptions');
  }

  validatePatchSessionRequest(data: unknown): void {
    this.parseWithValidationError(PatchSessionRequestSchema, data, 'Invalid PatchSessionRequest');
  }

  validatePatchSessionResponse(data: unknown): void {
    this.parseWithValidationError(PatchSessionResponseSchema, data, 'Invalid PatchSessionResponse');
  }

  validateProcessTemplateResponse(data: unknown): void {
    this.parseWithValidationError(ProcessTemplateResponseSchema, data, 'Invalid ProcessTemplateResponse');
  }

  // --- Discovery-driven validation ---

  /**
   * Cross-validates recording options against the server's declared capabilities.
   * Throws ValidationError with a descriptive message if any check fails.
   */
  validateAgainstDiscovery(options: RecordingOptions, config: ResolvedConfig): void {
    try {
      this.checkUploadType(options, config);
      this.checkLanguageHint(options, config);
      this.checkModel(options, config);
    } catch (error) {
      throw error;
    }
  }

  // --- Private helpers ---

  /**
   * Parses data against a Zod schema. On failure, converts ZodError
   * into our ValidationError with a human-readable message.
   */
  private parseWithValidationError(schema: z.ZodType, data: unknown, prefix: string): void {
    const result = schema.safeParse(data);
    if (!result.success) {
      const issues = this.formatZodIssues(result.error);
      throw new ValidationError(`${prefix}:\n${issues}`, {
        zodErrors: result.error.issues,
      });
    }
  }

  private formatZodIssues(error: z.ZodError): string {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') + ': ' : '';
        return `  - ${path}${issue.message}`;
      })
      .join('\n');
  }

  private checkUploadType(options: RecordingOptions, config: ResolvedConfig): void {
    if (!options.uploadType) {
      return;
    }

    if (config.supportedUploadMethods.length === 0) {
      return;
    }

    const supported = config.supportedUploadMethods;
    if (!supported.includes(options.uploadType)) {
      throw new ValidationError(
        `Upload type '${options.uploadType}' is not supported by the server. Supported: [${supported.join(', ')}]`,
        { requested: options.uploadType, supported }
      );
    }
  }

  private checkLanguageHint(options: RecordingOptions, config: ResolvedConfig): void {
    if (!options.languageHint || options.languageHint.length === 0) {
      return;
    }

    if (config.supportedLanguages.length === 0) {
      return;
    }

    const supported = config.supportedLanguages;
    for (const lang of options.languageHint) {
      if (!supported.includes(lang)) {
        throw new ValidationError(
          `Language '${lang}' is not supported by the server. Supported: [${supported.join(', ')}]`,
          { requested: lang, supported }
        );
      }
    }
  }

  private checkModel(options: RecordingOptions, config: ResolvedConfig): void {
    if (!options.model) {
      return;
    }

    if (config.availableModels.length === 0) {
      return;
    }

    const modelIds = config.availableModels.map((m) => m.id);
    if (!modelIds.includes(options.model)) {
      throw new ValidationError(
        `Model '${options.model}' is not available. Available: [${modelIds.join(', ')}]`,
        { requested: options.model, available: modelIds }
      );
    }
  }
}
