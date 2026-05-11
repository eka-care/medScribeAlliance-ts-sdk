/**
 * Discovery response validation schema (MedScribe Alliance Protocol).
 *
 * Schema validation only checks structure and types.
 * The discovery document IS the source of truth — we validate its shape,
 * not its values. The server defines what auth methods, upload methods,
 * response speeds, etc. are valid.
 */

import * as z from 'zod';

const ModelSchema = z.object({
  id: z.string().min(1, 'models[].id is required'),
  display_name: z.string().optional(),
  languages: z.array(z.string()).optional(),
  max_session_duration_seconds: z.number({
    error: 'models[].max_session_duration_seconds must be a number',
  }),
  response_speed: z.string().optional(),
  features: z
    .object({
      realtime_transcription: z.boolean().optional(),
      speaker_diarization: z.boolean().optional(),
      custom_templates: z.boolean().optional(),
    })
    .optional(),
});

const OidcSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  scopes_supported: z.array(z.string()),
});

export const DiscoveryResponseSchema = z.object({
  protocol: z.string().min(1, 'protocol is required'),
  protocol_version: z.string().min(1, 'protocol_version is required'),
  supported_versions: z.array(z.string()).optional(),
  service: z
    .object({
      name: z.string().optional(),
      documentation_url: z.string().optional(),
      support_email: z.string().optional(),
    })
    .optional(),
  endpoints: z.object({
    base_url: z.string().min(1, 'endpoints.base_url is required'),
    webhooks_url: z.string().optional(),
    authorization_endpoint: z.string().optional(),
    token_endpoint: z.string().optional(),
  }),
  authentication: z.object({
    supported_methods: z.array(z.string()),
    oidc: OidcSchema.optional(),
  }),
  capabilities: z.object({
    audio_formats: z
      .array(z.string())
      .min(1, 'capabilities.audio_formats must have at least one format'),
    max_chunk_duration_seconds: z
      .number()
      .positive('capabilities.max_chunk_duration_seconds must be positive'),
    upload_methods: z.array(z.string()).optional(),
    webhook_delivery: z.boolean().optional(),
    client_sdk_delivery: z.boolean().optional(),
  }),
  models: z.array(ModelSchema).optional().default([]),
  languages: z.object({
    supported: z.array(z.string()),
    auto_detection: z.boolean().optional(),
  }),
});

export type ValidatedDiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;
