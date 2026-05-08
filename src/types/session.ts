/**
 * Session lifecycle types (MedScribe Alliance Protocol)
 */

import { SessionStatus, TemplateStatus } from '../constants';

export interface CreateSessionRequest {
  templates: string[];
  model?: string;
  language_hint?: string[];
  transcript_language?: string[];
  upload_type: string;
  communication_protocol: string;
  additional_data?: Record<string, any>;
}

export interface CreateSessionResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  upload_url: string;
}

export interface EndSessionRequest {
  audio_files_sent: number;
}

export interface EndSessionResponse {
  session_id: string;
  status: SessionStatus;
  message: string;
  audio_files_received: number;
  audio_files: string[];
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
  error?: { code: string; message: string; details?: Record<string, any> };
}

export interface TemplatesOutput {
  [templateId: string]: TemplateEntry;
}

export interface TemplateEntry {
  status: TemplateStatus;
  data?: any;
  fhir?: any;
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

export interface PollOptions {
  maxAttempts?: number;
  intervalMs?: number;
  onProgress?: (status: GetSessionStatusResponse) => void;
}
