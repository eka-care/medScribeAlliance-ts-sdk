/**
 * SharedWorker script — runs MP3 compression + HTTP upload off the main thread.
 *
 * Message protocol:
 * - compress_and_upload: receives raw Float32Array, encodes to MP3, uploads via fetch
 * - wait_for_all_uploads: waits for all pending uploads to complete, then responds
 * - update_auth_token: updates the Bearer token used for uploads
 * - terminate: closes the port and cleans up
 *
 * Responds with:
 * - upload_success: upload completed for a file
 * - upload_failed: upload failed after retries
 * - all_uploads_complete: all pending uploads are done
 * - token_required: auth token is needed (401 response)
 *
 * Per-port routing: upload results are sent to the originating port only,
 * preventing cross-instance data corruption when multiple ScribeClient
 * instances share the same worker.
 */

import { encodeToMp3 } from '../audio/mp3-encoder';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../types/worker';

// Number of retries after the initial attempt.
// Total attempts per upload = 1 (initial) + DEFAULT_MAX_RETRIES = 3.
// Kept in sync with DEFAULT_MAX_RETRIES in ../constants (workers can't share the import).
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 2000;
const TOKEN_UPDATE_TIMEOUT_MS = 10_000;

// --- Worker state ---

let authToken: string | undefined;
const ports: MessagePort[] = [];

// Track pending uploads per port so wait_for_all_uploads only waits for that port's uploads
const pendingUploadsPerPort = new Map<MessagePort, Set<Promise<void>>>();

// Token refresh coordination — resolve when update_auth_token arrives
let tokenUpdateResolver: (() => void) | null = null;

/**
 * Send a message to a specific port.
 */
function sendToPort(port: MessagePort, message: WorkerToMainMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // Port may have been closed
  }
}

/**
 * Broadcast a message to all connected ports.
 * Used only for token_required (all instances need to know).
 */
function broadcast(message: WorkerToMainMessage): void {
  for (const port of ports) {
    sendToPort(port, message);
  }
}

interface UploadResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * Wait for a token update from the main thread.
 * Resolves when update_auth_token message arrives, or after safety timeout.
 */
function waitForTokenUpdate(): Promise<void> {
  return new Promise<void>((resolve) => {
    // If there's already a pending resolver, chain onto it
    const prev = tokenUpdateResolver;
    tokenUpdateResolver = () => {
      prev?.();
      resolve();
    };

    // Safety timeout — don't hang forever if consumer never provides a token
    setTimeout(() => {
      resolve();
    }, TOKEN_UPDATE_TIMEOUT_MS);
  });
}

/**
 * Upload a blob to the given URL with retry logic.
 * Returns success/failure with the server error message if available.
 */
async function uploadWithRetry(
  uploadUrl: string,
  fileName: string,
  blob: Blob,
  headers: Record<string, string>
): Promise<UploadResult> {
  let lastError = 'Upload failed after retries';
  let lastStatusCode: number | undefined;

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
        credentials: 'include',
      });

      if (response.ok) {
        return { success: true };
      }

      // Parse server error body for better error messages
      lastStatusCode = response.status;
      lastError = await parseErrorMessage(response);

      // 401 — request a new token from main thread, wait for it
      if (response.status === 401) {
        broadcast({ type: 'token_required' });
        await waitForTokenUpdate();
        continue;
      }

      // Non-retryable client errors (4xx except 408, 429)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        return { success: false, error: lastError, statusCode: lastStatusCode };
      }

      // Retryable error — wait and retry
      if (attempt < DEFAULT_MAX_RETRIES) {
        await sleep(DEFAULT_RETRY_DELAY_MS);
      }
    } catch (e: any) {
      lastError = e?.message ?? 'Network error';
      // Network error — retry
      if (attempt < DEFAULT_MAX_RETRIES) {
        await sleep(DEFAULT_RETRY_DELAY_MS);
      }
    }
  }

  return { success: false, error: lastError, statusCode: lastStatusCode };
}

/**
 * Parse the server error response body.
 * Server returns: { error: { code, message, details? } }
 */
async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message ?? body?.message ?? response.statusText ?? 'Request failed';
  } catch {
    return response.statusText ?? `HTTP ${response.status}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handle a compress_and_upload message:
 * 1. Encode Float32Array → MP3 Blob
 * 2. Upload with retries
 * 3. Send result to the originating port (not broadcast)
 */
async function handleCompressAndUpload(
  audioFrames: Float32Array,
  fileName: string,
  uploadUrl: string,
  headers: Record<string, string>,
  sourcePort: MessagePort
): Promise<void> {
  try {
    const encoded = encodeToMp3(audioFrames);

    if (!encoded) {
      sendToPort(sourcePort, {
        type: 'upload_failed',
        fileName,
        error: 'MP3 encoding failed',
      });
      return;
    }

    // Send raw MP3 bytes back to the main thread so consumers can offer
    // download / local playback via the chunk_ready event.
    sendToPort(sourcePort, {
      type: 'chunk_encoded',
      fileName,
      chunkData: encoded.chunks,
    });

    const result = await uploadWithRetry(uploadUrl, fileName, encoded.blob, headers);

    if (result.success) {
      sendToPort(sourcePort, { type: 'upload_success', fileName });
    } else {
      sendToPort(sourcePort, {
        type: 'upload_failed',
        fileName,
        error: result.error ?? 'Upload failed after retries',
        blob: encoded.blob,
      });
    }
  } catch (error: any) {
    sendToPort(sourcePort, {
      type: 'upload_failed',
      fileName,
      error: error?.message ?? 'Unknown error',
    });
  }
}

/**
 * Handle incoming messages from a connected port.
 * Each port maps to one WorkerManager instance.
 */
function handleMessage(message: MainToWorkerMessage, sourcePort: MessagePort): void {
  switch (message.type) {
    case 'compress_and_upload': {
      if (!pendingUploadsPerPort.has(sourcePort)) {
        pendingUploadsPerPort.set(sourcePort, new Set());
      }
      const portPending = pendingUploadsPerPort.get(sourcePort)!;

      const uploadPromise = handleCompressAndUpload(
        message.audioFrames,
        message.fileName,
        message.uploadUrl,
        message.headers,
        sourcePort
      );
      portPending.add(uploadPromise);
      uploadPromise.finally(() => portPending.delete(uploadPromise));
      break;
    }

    case 'wait_for_all_uploads': {
      const portPending = pendingUploadsPerPort.get(sourcePort) ?? new Set();
      Promise.all(portPending).then(() => {
        sendToPort(sourcePort, { type: 'all_uploads_complete' });
      });
      break;
    }

    case 'update_auth_token': {
      authToken = message.token;
      // Unblock any upload retries waiting for a fresh token
      if (tokenUpdateResolver) {
        tokenUpdateResolver();
        tokenUpdateResolver = null;
      }
      break;
    }

    case 'terminate': {
      // Clean up this port's resources
      const idx = ports.indexOf(sourcePort);
      if (idx >= 0) {
        ports.splice(idx, 1);
      }
      pendingUploadsPerPort.delete(sourcePort);
      try {
        sourcePort.close();
      } catch {
        // Ignore
      }

      // If no more connected ports, shut down the worker
      if (ports.length === 0) {
        self.close();
      }
      break;
    }
  }
}

// --- SharedWorker entry point ---

// SharedWorkerGlobalScope type — not available in standard lib, declared here
// since this file is compiled as a worker entry point.
declare interface SharedWorkerGlobalScope {
  onconnect: ((event: MessageEvent) => void) | null;
  close(): void;
}

const _self = self as unknown as SharedWorkerGlobalScope;

_self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  ports.push(port);

  port.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
    handleMessage(e.data, port);
  };

  port.start();
};
