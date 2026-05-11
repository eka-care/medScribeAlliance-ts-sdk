/**
 * Session lifecycle types (MedScribe Alliance Protocol)
 */

import { SessionStatus, TemplateStatus } from '../constants';

export interface PatientDetails {
  oid?: string;
  name?: string;
  age?: string;
  gender?: string;
  mobile?: number;
}

export interface CreateSessionRequest {
  templates: string[];
  model?: string;
  language_hint?: string[];
  transcript_language?: string;
  upload_type: string;
  communication_protocol: string;
  additional_data?: Record<string, any>;
  session_mode?: string;
  patient_details?: PatientDetails;
  session_id?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  upload_url: string;
  patient_details?: PatientDetails;
}

export interface EndSessionRequest {
  audio_files_sent: number;
  audio_files_uploaded: number;
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
  expired_at?: string;
  completed_at?: string;
  model_used?: string;
  language_detected?: string;
  audio_files_received: number;
  audio_files: string[];
  audio_files_processed?: number;
  additional_data: Record<string, any>;
  templates?: TemplateEntry[];
  transcript?: string;
  processing_errors?: ProcessingError[];
  error?: { code: string; message: string; details?: Record<string, any> };
  patient_details?: PatientDetails;
  message?: string;
}

export interface TemplateEntry {
  [templateId: string]: TemplateEntryData;
}

export interface TemplateEntryData {
  status: TemplateStatus;
  data?: any;
  fhir?: any;
  error?: TemplateError;
  document_id?: string;
  document_type?: string;
  publish?: boolean;
  presigned_url?: string;
  presigned_url_expires_at?: string;
  errors?: any[];
  warnings?: any[];
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
  /** AbortSignal to cancel polling early. */
  signal?: AbortSignal;
}

// --- Patch Session ---

export interface PatchSessionRequest {
  user_status?: string;
  processing_status?: string;
  patient_details?: PatientDetails;
  additional_data?: Record<string, any>;
  language_hint?: string[];
  transcript_language?: string;
  templates?: string[];
}

export interface PatchSessionResponse {
  session_id: string;
  status: string;
  message: string;
}

// --- Process Template ---

export interface ProcessTemplateResponse {
  session_id: string;
  template_id: string;
  status: string;
  message: string;
}
