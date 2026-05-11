/**
 * Discovery document types (MedScribe Alliance Protocol)
 */

export interface DiscoveryDocument {
  protocol: string;
  protocol_version: string;
  supported_versions?: string[];
  service?: ServiceInfo;
  endpoints: EndpointsInfo;
  authentication: AuthenticationInfo;
  capabilities: CapabilitiesInfo;
  models?: ModelConfig[];
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
  templates_url?: string;
}

export interface AuthenticationInfo {
  supported_methods: string[];
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
  upload_methods?: string[];
  webhook_delivery?: boolean;
  client_sdk_delivery?: boolean;
}

export interface ModelConfig {
  id: string;
  display_name?: string;
  languages?: string[];
  max_session_duration_seconds: number;
  response_speed?: string;
  features?: {
    realtime_transcription?: boolean;
    speaker_diarization?: boolean;
    custom_templates?: boolean;
  };
}

export interface LanguagesInfo {
  supported: string[];
  auto_detection?: boolean;
}

/**
 * Parsed runtime configuration derived from DiscoveryDocument.
 * Used by all layers at runtime for validation and configuration.
 */
export interface ResolvedConfig {
  baseUrl: string;
  webhooksUrl?: string;
  supportedLanguages: string[];
  autoDetectLanguage: boolean;
  supportedAudioFormats: string[];
  supportedUploadMethods: string[];
  maxChunkDurationSeconds: number;
  /** modelId -> max session duration in seconds */
  maxSessionDurationSeconds: Map<string, number>;
  supportedAuthMethods: string[];
  availableModels: ModelConfig[];
  webhookDelivery: boolean;
  clientSdkDelivery: boolean;
}
