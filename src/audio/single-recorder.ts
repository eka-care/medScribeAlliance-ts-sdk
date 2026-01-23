import { IRecorder } from './recorder.interface';
import { CreateSessionResponse } from '../types';
import { EventEmitter } from "../utils/events"

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
      
        // Upload the file
        try {
            // Check if uploadUrl needs filename suffix or is a direct PUT target?
            // "uploading chunks to the upload_url" logic was for chunks.
            // For single file, usually upload_url IS the target.
            // But if it's a folder, we might need a name.
            // Let's assume it works like a PUT to the URL.
            
            // TODO: single file upload - name, request
            // TODO: retry logic for file upload
            const response = await fetch(this.uploadUrl, {
                method: 'PUT',
                body: audioBlob,
                headers: {
                    'Content-Type': audioBlob.type,
                }
            });
            
            if (!response.ok) {
                 resolve({ failedUploads: ['single_file'], totalFiles: 1 });
            } else {
                 resolve({ failedUploads: [], totalFiles: 1 });
            }
        } catch (e) {
            resolve({ failedUploads: ['single_file'], totalFiles: 1 });
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
