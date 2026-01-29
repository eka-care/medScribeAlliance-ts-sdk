import { CreateSessionResponse } from '../types';

export interface RecorderConfig {
  accessToken?: string;
}

export interface IRecorder {
  initialize(session: CreateSessionResponse, config?: RecorderConfig): void;
  start(deviceId?: string): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<{ failedUploads: string[]; totalFiles?: number }>;
  reset(): void;
  isPaused(): boolean;
}
