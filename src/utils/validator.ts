/**
 * Schema Validator using AJV
 * Validates API requests against OpenAPI schemas
 */

import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { ValidationError } from './errors';
import schemas from '../schemas/openapi-schemas.json';

// TODO: verify this validations
class SchemaValidator {
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();

  constructor() {
    // Initialize AJV with strict mode and all errors
    this.ajv = new Ajv({
      allErrors: true,
      strict: true,
      validateFormats: true,
    });

    // Add format validators (date-time, uri, etc.)
    addFormats(this.ajv);

    // Compile schemas
    this.compileSchemas();
  }

  private compileSchemas(): void {
    // Add all schema definitions first
    if (schemas.definitions) {
      Object.entries(schemas.definitions).forEach(([key, schema]) => {
        try {
          const validate = this.ajv.compile({
            ...schema,
            $schema: schemas.$schema,
            definitions: schemas.definitions,
          });
          this.validators.set(key, validate);
        } catch (error) {
          console.error(`Failed to compile schema for ${key}:`, error);
        }
      });
    }
  }

  /**
   * Validate data against a specific schema
   */
  validate(schemaName: string, data: unknown): void {
    const validator = this.validators.get(schemaName);

    if (!validator) {
      throw new ValidationError(`Schema '${schemaName}' not found`);
    }

    const valid = validator(data);

    if (!valid && validator.errors) {
      const errorMessages = this.formatErrors(validator.errors);
      throw new ValidationError(
        `Validation failed for ${schemaName}:\n${errorMessages}`
      );
    }
  }

  /**
   * Validate CreateSessionRequest
   */
  validateCreateSessionRequest(data: unknown): void {
    this.validate('CreateSessionRequest', data);
  }

  /**
   * Validate session ID parameter
   */
  validateSessionId(sessionId: string): void {
    this.validate('SessionIdParam', sessionId);
  }

  /**
   * Format AJV errors into readable messages
   */
  private formatErrors(errors: ErrorObject[]): string {
    return errors
      .map((error) => {
        const path = error.instancePath || 'root';
        let message = `${path}: ${error.message}`;

        // Add additional context for certain error types
        if (error.keyword === 'enum') {
          message += ` (allowed values: ${(error.params as any).allowedValues?.join(', ')})`;
        } else if (error.keyword === 'pattern') {
          message += ` (pattern: ${(error.params as any).pattern})`;
        } else if (error.keyword === 'required') {
          message += ` (missing property: ${(error.params as any).missingProperty})`;
        } else if (error.keyword === 'type') {
          message += ` (expected type: ${(error.params as any).type})`;
        }

        return `  - ${message}`;
      })
      .join('\n');
  }

  /**
   * Get validator instance for custom validation
   */
  getValidator(schemaName: string): ValidateFunction | undefined {
    return this.validators.get(schemaName);
  }
}

// Export singleton instance
export const schemaValidator = new SchemaValidator();
