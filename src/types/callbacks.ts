/**
 * Callback system types — 6 grouped callbacks with discriminated union payloads
 */

import { CreateSessionResponse, EndSessionResponse, GetSessionStatusResponse } from './session';

// --- Recording State ---

export type RecordingState = 'started' | 'paused' | 'resumed' | 'ended';

export interface RecordingStateChangeEvent {
  type: RecordingState;
  timestamp: string;
  data?: any;
}

// --- Audio Events ---

export type AudioEventType = 'user_speech' | 'silence_warning' | 'chunk_ready' | 'frame_processed';

export interface AudioEventUserSpeech {
  type: 'user_speech';
  timestamp: string;
  data: { isSpeaking: boolean };
}

export interface AudioEventSilenceWarning {
  type: 'silence_warning';
  timestamp: string;
  data: { durationMs: number };
}

export interface AudioEventChunkReady {
  type: 'chunk_ready';
  timestamp: string;
  data: { chunkIndex: number; fileName: string };
}

export interface AudioEventFrameProcessed {
  type: 'frame_processed';
  timestamp: string;
  data: { isSpeech: number; notSpeech: number };
}

export type AudioEvent =
  | AudioEventUserSpeech
  | AudioEventSilenceWarning
  | AudioEventChunkReady
  | AudioEventFrameProcessed;

// --- Upload Events ---

export type UploadEventType = 'progress' | 'failed' | 'retry';

export interface UploadEventProgress {
  type: 'progress';
  timestamp: string;
  data: { successCount: number; totalCount: number };
}

export interface UploadEventFailed {
  type: 'failed';
  timestamp: string;
  data: { fileName: string; error: string };
}

export interface UploadEventRetry {
  type: 'retry';
  timestamp: string;
  data: { fileName: string; attempt: number };
}

export type UploadEvent = UploadEventProgress | UploadEventFailed | UploadEventRetry;

// --- Session Events ---

export type SessionEventType = 'created' | 'ended' | 'status_update' | 'partial_result';

export interface SessionEventCreated {
  type: 'created';
  timestamp: string;
  data: CreateSessionResponse;
}

export interface SessionEventEnded {
  type: 'ended';
  timestamp: string;
  data: EndSessionResponse;
}

export interface SessionEventStatusUpdate {
  type: 'status_update';
  timestamp: string;
  data: GetSessionStatusResponse;
}

export interface SessionEventPartialResult {
  type: 'partial_result';
  timestamp: string;
  data: any;
}

export type SessionEvent =
  | SessionEventCreated
  | SessionEventEnded
  | SessionEventStatusUpdate
  | SessionEventPartialResult;

// --- Error Events ---

export type ErrorEventType = 'vad_error' | 'worker_error' | 'transport_error' | 'validation_error';

export interface ErrorEvent {
  type: ErrorEventType;
  timestamp: string;
  error: { code: string; message: string; details?: any };
}

// --- Token Required ---

export interface TokenRequiredEvent {
  resolve: (newToken: string) => void;
}

// --- Callback Map (used by CallbackRegistry) ---

export interface CallbackMap {
  onRecordingStateChange: (event: RecordingStateChangeEvent) => void;
  onAudioEvent: (event: AudioEvent) => void;
  onUploadEvent: (event: UploadEvent) => void;
  onSessionEvent: (event: SessionEvent) => void;
  onError: (event: ErrorEvent) => void;
  onTokenRequired: (event: TokenRequiredEvent) => void;
}

export type CallbackName = keyof CallbackMap;
