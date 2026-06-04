/**
 * Recording types
 */

import { CreateSessionResponse, EndSessionResponse, PatientDetails } from './session';

export interface RecordingOptions {
  templates: string[] | [];
  model?: string;
  languageHint?: string[];
  transcriptLanguage?: string;
  uploadType?: string;
  communicationProtocol?: string;
  additionalData?: Record<string, any>;
  deviceId?: string;
  sessionMode?: string;
  patientDetails?: PatientDetails;
  sessionId?: string;
}

export interface RecorderConfig {
  accessToken?: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  sessionId: string;
}

export interface IRecorder {
  initialize(session: CreateSessionResponse, config: RecorderConfig): void;
  start(deviceId?: string): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<StopRecordingResult>;
  reset(): void;
  isPaused(): boolean;
}

export interface StopRecordingResult {
  failedUploads: string[];
  totalFiles: number;
}

/**
 * Result of ScribeClient.endRecording() / RecordingManager.stop().
 */
export interface EndRecordingResult extends StopRecordingResult {
  sessionEnded: boolean;
  endSessionResponse?: EndSessionResponse;
}

/**
 * Audio chunk metadata tracked by AudioFileManager
 */
export type AudioChunkInfo = {
  fileName: string;
  timestamp: { st: string; et: string };
  response?: string;
} & (
  | { status: 'pending'; audioFrames: Float32Array; fileBlob?: undefined }
  | { status: 'success'; audioFrames?: undefined; fileBlob?: undefined }
  | { status: 'failure'; fileBlob: Blob; audioFrames?: undefined }
);

export interface RetryUploadResult {
  /** Number of files retried */
  retried: number;
  /** Number that succeeded on retry */
  succeeded: number;
  /** File names that still failed after retry */
  stillFailed: string[];
}

export type UploadProgressCallback = (successFiles: string[], totalCount: number) => void;
