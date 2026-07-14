/**
 * Recording types
 */

import {
  CreateSessionResponse,
  EndSessionResponse,
  PatientDetails,
  SessionUploadInfo,
} from './session';

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
  /** Optional API version; sent as a `version` query param on the create-session request. */
  version?: string;
}

export interface RecorderConfig {
  accessToken?: string;
  /** Provider-specific upload payload from the create-session response. */
  upload: SessionUploadInfo;
  storageProvider: string;
  uploadHeaders: Record<string, string>;
  sessionId: string;
  // Fetch a fresh upload payload on upload failure (expired presigned URL); null if unavailable.
  refreshUploadUrl?: () => Promise<SessionUploadInfo | null>;
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
  | { status: 'pending'; audioFrames?: Float32Array; fileBlob?: Blob }
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

/** Result of ScribeClient.uploadAudioFile() — the storage backend's full response. */
export interface UploadAudioFileResult {
  /** The storage object name used. */
  fileName: string;
  /** HTTP status from the storage backend (e.g. 204 for an S3 presigned POST). */
  status: number;
  /** Response headers from the storage backend (e.g. ETag). */
  headers: Record<string, string>;
  /** Raw response body from the storage backend (often empty for S3). */
  response: unknown;
}

export type UploadProgressCallback = (successFiles: string[], totalCount: number) => void;
