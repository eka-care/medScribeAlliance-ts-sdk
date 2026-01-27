/**
 * Type Definitions for Scribe EMR Protocol
 * Based on MedScribe Alliance Protocol Specification
 */

import { ErrorCode, SessionStatus, TemplateStatus, UploadType } from '../constants';

/**
 * Discovery Document Types (Spec 04)
 */

export interface DiscoveryDocument {
  protocol: string;
  protocol_version: string;
  supported_versions: string[];
  service: ServiceInfo;
  endpoints: EndpointsInfo;
  authentication: AuthenticationInfo;
  capabilities: CapabilitiesInfo;
  models: ModelConfig[];
  languages: LanguagesInfo;
}

export interface ServiceInfo {
  name?: string;
  documentation_url?: string;
  support_email?: string;
}

export interface EndpointsInfo {
  base_url: string;
  webhooks_url?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
}

export interface AuthenticationInfo {
  supported_methods: ('api_key' | 'oidc')[];
  oidc?: {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    scopes_supported: string[];
  };
}

export interface CapabilitiesInfo {
  audio_formats: string[];
  max_chunk_duration_seconds: number;
  upload_methods?: UploadType[];
  webhook_delivery?: boolean;
  client_sdk_delivery?: boolean;
}

export interface ModelConfig {
  id: string;
  display_name: string;
  languages: string[];
  max_session_duration_seconds: number;
  response_speed: 'fast' | 'standard' | 'slow';
  features: {
    realtime_transcription: boolean;
    speaker_diarization: boolean;
    custom_templates: boolean;
  };
}

export interface LanguagesInfo {
  supported: string[];
  auto_detection?: boolean;
}

/**
 * Session Types (Spec 06)
 */

export interface CreateSessionRequest {
  templates: string[];
  model?: string;
  language_hint?: string[];
  transcript_language?: string[];
  upload_type: UploadType;
  communication_protocol: 'websocket' | 'http' | 'rpc';
  additional_data?: Record<string, any>;
}

export interface CreateSessionResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  upload_url: string;
}

export interface GetSessionStatusResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at?: string;
  completed_at?: string;
  model_used?: string;
  language_detected?: string;
  audio_files_received?: number;
  audio_files?: string[];
  audio_files_processed?: number;
  additional_data?: Record<string, any>;
  templates?: TemplatesOutput;
  transcript?: string;
  processing_errors?: ProcessingError[];
  error?: ApiError;
}

export interface EndSessionResponse {
  session_id: string;
  status: SessionStatus;
  message: string;
  audio_files_received: number;
  audio_files: string[];
}

/**
 * Extraction & Response Types (Spec 09)
 */

export interface TemplatesOutput {
  [templateId: string]: TemplateEntry;
}

export interface TemplateEntry {
  status: TemplateStatus;
  data?: any;
  error?: TemplateError;
}

export interface TemplateError {
  code: string;
  message: string;
}

export interface ProcessingError {
  type: string;
  message: string;
  file?: string;
}

/**
 * Error Types (Spec 11)
 */

export interface ApiError {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, any>;
}

export interface ErrorResponse {
  error: ApiError;
}

/**
 * SDK Configuration
 */

export interface ScribeSDKConfig {
  apiKey?: string;
  baseUrl: string;
  debug?: boolean;
  autoDiscovery?: boolean;
}

/**
 * Recording Options
 */

export interface RecordingOptions {
  templates: string[];
  model?: string;
  languageHint?: string[];
  transcriptLanguage?: string[];
  uploadType?: UploadType;
  communicationProtocol?: 'websocket' | 'http' | 'rpc';
  additionalData?: Record<string, any>;
}

/**
 * SDK Events
 */

export type SDKEventType =
  | 'discovery:complete'
  | 'session:created'
  | 'session:ended'
  | 'session:status_update'
  | 'recording:paused'
  | 'recording:resumed'
  | 'error';

export interface SDKEvent {
  type: SDKEventType;
  data?: any;
  error?: Error;
}
