/**
 * Session request/response validation schemas (MedScribe Alliance Protocol).
 *
 * Aligned with protocol spec v0.1 (spec/06-sessions.md).
 * Schema validation only checks structure and types.
 * Value validation (e.g., is this upload_type supported?) happens
 * in discovery-driven validation via Validator.validateAgainstDiscovery().
 */

import * as z from 'zod';

// --- Request schemas ---

export const CreateSessionRequestSchema = z.object({
  templates: z
    .array(z.string())
    .min(1, 'templates must contain at least one item')
    .max(2, 'templates cannot have more than 2 items'),
  upload_type: z.string().min(1, 'upload_type is required'),
  communication_protocol: z.string().min(1, 'communication_protocol is required'),
  model: z.string().optional(),
  language_hint: z.array(z.string().max(2, 'language_hint items must be at most 2 characters')).optional(),
  transcript_language: z
    .array(z.string().max(2, 'transcript_language items must be at most 2 characters'))
    .optional(),
  additional_data: z.record(z.string(), z.any()).optional(),
});

export type ValidatedCreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const EndSessionRequestSchema = z.object({
  audio_files_sent: z.number().int().min(0, 'audio_files_sent must be a non-negative integer'),
});

// --- Response schemas ---

// Spec: session_id, status, created_at, expires_at, upload_url are all REQUIRED
export const CreateSessionResponseSchema = z.object({
  session_id: z.string().min(1, 'session_id is required'),
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  upload_url: z.string().min(1, 'upload_url is required'),
});

// Spec: session_id, status, message, audio_files_received, audio_files are all REQUIRED
export const EndSessionResponseSchema = z.object({
  session_id: z.string().min(1, 'session_id is required'),
  status: z.string(),
  message: z.string(),
  audio_files_received: z.number().int(),
  audio_files: z.array(z.string()),
});

// Spec: session_id, status, created_at, audio_files_received, audio_files are REQUIRED
// Other fields are optional and depend on session state
export const GetSessionStatusResponseSchema = z.object({
  session_id: z.string().min(1, 'session_id is required'),
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string().optional(),
  completed_at: z.string().optional(),
  model_used: z.string().optional(),
  language_detected: z.string().optional(),
  audio_files_received: z.number().int(),
  audio_files: z.array(z.string()),
  audio_files_processed: z.number().int().optional(),
  additional_data: z.record(z.string(), z.any()).optional(),
  templates: z.record(z.string(), z.any()).optional(),
  transcript: z.string().nullable().optional(),
  processing_errors: z
    .array(
      z.object({
        type: z.string(),
        message: z.string(),
        file: z.string().optional(),
      })
    )
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
});

// --- Parameter schemas ---

// Session ID format is server-defined — we only validate it's a non-empty string.
export const SessionIdSchema = z.string().min(1, 'Session ID is required');
