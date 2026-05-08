/**
 * Recording types
 */

import { UploadType } from '../constants';
import { CreateSessionResponse } from './session';

export interface RecordingOptions {
  templates: string[];
  model?: string;
  languageHint?: string[];
  transcriptLanguage?: string[];
  uploadType?: UploadType;
  communicationProtocol?: 'websocket' | 'http' | 'rpc';
  additionalData?: Record<string, any>;
  deviceId?: string;
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

export type UploadProgressCallback = (successFiles: string[], totalCount: number) => void;
