import { CreateSessionResponse } from '../types';

export interface IRecorder {
  initialize(session: CreateSessionResponse): void;
  start(deviceId?: string): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<{ failedUploads: string[]; totalFiles?: number }>;
  reset(): void;
  isPaused(): boolean;
}
