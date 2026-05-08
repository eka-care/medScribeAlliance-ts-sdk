/**
 * SharedWorker script — runs MP3 compression + HTTP upload off the main thread.
 *
 * Message protocol:
 * - compress_and_upload: receives raw Float32Array, encodes to MP3, uploads via fetch
 * - wait_for_all_uploads: waits for all pending uploads to complete, then responds
 * - update_auth_token: updates the Bearer token used for uploads
 * - terminate: closes the worker
 *
 * Responds with:
 * - upload_success: upload completed for a file
 * - upload_failed: upload failed after retries
 * - all_uploads_complete: all pending uploads are done
 * - token_required: auth token is needed (401 response)
 */

import { encodeToMp3 } from '../audio/mp3-encoder';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../types/worker';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

// --- Worker state ---

let authToken: string | undefined;
const pendingUploads: Set<Promise<void>> = new Set();
const ports: MessagePort[] = [];

/**
 * Broadcast a message to all connected ports.
 */
function broadcast(message: WorkerToMainMessage): void {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      // Port may have been closed
    }
  }
}

/**
 * Upload a blob to the given URL with retry logic.
 * Returns true on success, false on failure.
 */
async function uploadWithRetry(
  uploadUrl: string,
  fileName: string,
  blob: Blob,
  headers: Record<string, string>
): Promise<boolean> {
  for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
    try {
      const fullUrl = uploadUrl.endsWith('/')
        ? `${uploadUrl}${fileName}`
        : `${uploadUrl}/${fileName}`;

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'audio/mp3',
        ...headers,
      };

      // Apply current auth token
      if (authToken) {
        requestHeaders['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(fullUrl, {
        method: 'POST',
        body: blob,
        headers: requestHeaders,
      });

      if (response.ok) {
        return true;
      }

      // 401 — request a new token from main thread
      if (response.status === 401) {
        broadcast({ type: 'token_required' });
        // Wait a bit for token update before retrying
        await sleep(DEFAULT_RETRY_DELAY_MS);
        continue;
      }

      // Non-retryable client errors (4xx except 408, 429)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        return false;
      }

      // Retryable error — wait and retry
      if (attempt < DEFAULT_MAX_RETRIES) {
        await sleep(DEFAULT_RETRY_DELAY_MS);
      }
    } catch {
      // Network error — retry
      if (attempt < DEFAULT_MAX_RETRIES) {
        await sleep(DEFAULT_RETRY_DELAY_MS);
      }
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handle a compress_and_upload message:
 * 1. Encode Float32Array → MP3 Blob
 * 2. Upload with retries
 * 3. Broadcast success/failure
 */
async function handleCompressAndUpload(
  audioFrames: Float32Array,
  fileName: string,
  uploadUrl: string,
  headers: Record<string, string>
): Promise<void> {
  try {
    const mp3Blob = encodeToMp3(audioFrames);

    if (!mp3Blob) {
      broadcast({
        type: 'upload_failed',
        fileName,
        error: 'MP3 encoding failed',
      });
      return;
    }

    const success = await uploadWithRetry(uploadUrl, fileName, mp3Blob, headers);

    if (success) {
      broadcast({ type: 'upload_success', fileName });
    } else {
      broadcast({
        type: 'upload_failed',
        fileName,
        error: 'Upload failed after retries',
      });
    }
  } catch (error: any) {
    broadcast({
      type: 'upload_failed',
      fileName,
      error: error?.message ?? 'Unknown error',
    });
  }
}

/**
 * Handle incoming messages from a connected port.
 */
function handleMessage(message: MainToWorkerMessage): void {
  switch (message.type) {
    case 'compress_and_upload': {
      const uploadPromise = handleCompressAndUpload(
        message.audioFrames,
        message.fileName,
        message.uploadUrl,
        message.headers
      );
      pendingUploads.add(uploadPromise);
      uploadPromise.finally(() => pendingUploads.delete(uploadPromise));
      break;
    }

    case 'wait_for_all_uploads': {
      Promise.all(pendingUploads).then(() => {
        broadcast({ type: 'all_uploads_complete' });
      });
      break;
    }

    case 'update_auth_token': {
      authToken = message.token;
      break;
    }

    case 'terminate': {
      // Close all ports and terminate
      for (const port of ports) {
        try {
          port.close();
        } catch {
          // Ignore
        }
      }
      self.close();
      break;
    }
  }
}

// --- SharedWorker entry point ---

// SharedWorkerGlobalScope
const _self = self as unknown as SharedWorkerGlobalScope;

_self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  ports.push(port);

  port.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
    handleMessage(e.data);
  };

  port.start();
};
