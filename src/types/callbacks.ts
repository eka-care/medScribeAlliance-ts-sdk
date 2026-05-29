/**
 * Callback system types — 6 grouped callbacks with discriminated union payloads
 */

import { CreateSessionResponse, EndSessionResponse, GetSessionStatusResponse } from './session';
import {
  RecordingState,
  AudioEventType,
  UploadEventType,
  SessionEventType,
  ErrorEventType,
  ErrorCode,
  DiscardReason,
} from '../constants';

// --- Recording State ---

export type { RecordingState } from '../constants';

export interface RecordingStateChangeEvent {
  type: RecordingState;
  timestamp: string;
  data?: any;
}

// --- Audio Events ---

export type { AudioEventType } from '../constants';

export interface AudioEventUserSpeech {
  type: AudioEventType.USER_SPEECH;
  timestamp: string;
  data: { isSpeaking: boolean };
}

export interface AudioEventSilenceWarning {
  type: AudioEventType.SILENCE_WARNING;
  timestamp: string;
  data: { durationMs: number };
}

export interface AudioEventChunkReady {
  type: AudioEventType.CHUNK_READY;
  timestamp: string;
  data: {
    chunkIndex: number;
    fileName: string;
    chunkData: Uint8Array[];
  };
}

export interface AudioEventFrameProcessed {
  type: AudioEventType.FRAME_PROCESSED;
  timestamp: string;
  data: { isSpeech: number; notSpeech: number; frame: Float32Array; duration: number };
}

export type AudioEvent =
  | AudioEventUserSpeech
  | AudioEventSilenceWarning
  | AudioEventChunkReady
  | AudioEventFrameProcessed;

// --- Upload Events ---

export type { UploadEventType } from '../constants';

export interface UploadEventProgress {
  type: UploadEventType.PROGRESS;
  timestamp: string;
  data: { successCount: number; totalCount: number };
}

export interface UploadEventFailed {
  type: UploadEventType.FAILED;
  timestamp: string;
  data: { fileName: string; error: string };
}

export interface UploadEventRetry {
  type: UploadEventType.RETRY;
  timestamp: string;
  data: { fileName: string; attempt: number };
}

export type UploadEvent = UploadEventProgress | UploadEventFailed | UploadEventRetry;

// --- Session Events ---

export type { SessionEventType } from '../constants';

export interface SessionEventCreated {
  type: SessionEventType.CREATED;
  timestamp: string;
  data: CreateSessionResponse;
}

export interface SessionEventEnded {
  type: SessionEventType.ENDED;
  timestamp: string;
  data: EndSessionResponse;
}

export interface SessionEventDiscarded {
  type: SessionEventType.DISCARDED;
  timestamp: string;
  data: { sessionId: string | null; reason: DiscardReason };
}

export interface SessionEventStatusUpdate {
  type: SessionEventType.STATUS_UPDATE;
  timestamp: string;
  data: GetSessionStatusResponse;
}

export interface SessionEventPartialResult {
  type: SessionEventType.PARTIAL_RESULT;
  timestamp: string;
  data: any;
}

export type SessionEvent =
  | SessionEventCreated
  | SessionEventEnded
  | SessionEventDiscarded
  | SessionEventStatusUpdate
  | SessionEventPartialResult;

// --- Error Events ---

export type { ErrorEventType } from '../constants';

export interface ErrorEvent {
  type: ErrorEventType;
  timestamp: string;
  error: { code: ErrorCode; message: string; details?: any };
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
