/**
 * Recording options validation schema (consumer-facing).
 *
 * Schema validation only checks structure and types.
 * Value validation (e.g., is this uploadType supported?) happens
 * in discovery-driven validation via Validator.validateAgainstDiscovery().
 */

import * as z from 'zod';

export const RecordingOptionsSchema = z.object({
  templates: z
    .array(z.string())
    .min(1, 'templates must contain at least one item')
    .max(2, 'templates cannot have more than 2 items'),
  uploadType: z.string().optional(),
  communicationProtocol: z.string().optional(),
  model: z.string().optional(),
  languageHint: z.array(z.string().max(2, 'languageHint items must be at most 2 characters')).optional(),
  transcriptLanguage: z.string().optional(),
  deviceId: z.string().optional(),
  additionalData: z.record(z.string(), z.any()).optional(),
  sessionMode: z.string().optional(),
  patientDetails: z
    .object({
      name: z.string().optional(),
      age: z.string().optional(),
      gender: z.string().optional(),
    })
    .optional(),
  txnId: z.string().optional(),
});

export type ValidatedRecordingOptions = z.infer<typeof RecordingOptionsSchema>;
