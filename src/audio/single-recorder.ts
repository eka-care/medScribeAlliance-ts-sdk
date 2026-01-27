import { IRecorder } from './recorder.interface';
import { CreateSessionResponse } from '../types';
import { EventEmitter } from "../utils/events";
import { uploadFileWithFormData } from '../utils/upload';

export class SingleRecorder implements IRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private uploadUrl: string = '';
  private stream: MediaStream | null = null;
  private eventEmitter?: EventEmitter;

  constructor(eventEmitter?: EventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  initialize(session: CreateSessionResponse): void {
    if (!session.upload_url) {
      throw new Error('Upload URL is required for single recording');
    }
    this.uploadUrl = session.upload_url;
  }

  async start(deviceId?: string): Promise<void> {
    this.audioChunks = [];
    
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch (e: any) {
      if (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError') {
         stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw e;
      }
    }
    
    this.stream = stream;
    this.mediaRecorder = new MediaRecorder(stream);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start();
  }

  async stop(): Promise<{ failedUploads: string[]; totalFiles?: number }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        resolve({ failedUploads: [], totalFiles: 0 });
        return;
      }

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const fileName = `recording_${Date.now()}.webm`;

        // Upload the file using form data with retry
        const response = await uploadFileWithFormData(
          this.uploadUrl,
          fileName,
          audioBlob
        );

        if (response.success) {
          resolve({ failedUploads: [], totalFiles: 1 });
        } else {
          resolve({ failedUploads: [fileName], totalFiles: 1 });
        }

        // Clean up stream
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.mediaRecorder = null;
      };

      this.mediaRecorder.stop();
    });
  }

  reset(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
  }
}
