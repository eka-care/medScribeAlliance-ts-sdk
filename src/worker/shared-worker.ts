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
import { getStorageProvider } from '../storage/storage-provider-factory';
import type { PreparedUpload } from '../storage/storage-provider.interface';

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

// upload_url refresh coordination — per-port set of waiters (concurrent chunks can each
// await). The refreshed upload_url is session-wide, so one update resolves all of them.
const uploadUrlResolvers = new Map<MessagePort, Set<(upload: unknown | null) => void>>();

// Resolve (and clear) every upload_url waiter for a port with the given payload.
function resolveUploadUrlWaiters(port: MessagePort, upload: unknown | null): void {
  const waiters = uploadUrlResolvers.get(port);
  if (!waiters) return;
  uploadUrlResolvers.delete(port);
  for (const resolve of waiters) resolve(upload);
}

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

// Wait for a fresh upload payload from the main thread; null if none arrives before the timeout.
function waitForUploadUrlUpdate(port: MessagePort): Promise<unknown | null> {
  return new Promise<unknown | null>((resolve) => {
    let waiters = uploadUrlResolvers.get(port);
    if (!waiters) {
      waiters = new Set();
      uploadUrlResolvers.set(port, waiters);
    }
    waiters.add(resolve);
    setTimeout(() => {
      const current = uploadUrlResolvers.get(port);
      if (current?.has(resolve)) {
        current.delete(resolve);
        if (current.size === 0) uploadUrlResolvers.delete(port);
        resolve(null);
      }
    }, TOKEN_UPDATE_TIMEOUT_MS);
  });
}

/**
 * Build the fetch RequestInit for a prepared upload.
 * Service auth (Bearer/flavour/credentials) is attached only when attachAuth is true.
 */
function buildUploadInit(
  prepared: PreparedUpload,
  fileName: string,
  blob: Blob,
  serviceHeaders: Record<string, string>
): RequestInit {
  const requestHeaders: Record<string, string> = { ...prepared.headers };

  if (prepared.attachAuth) {
    Object.assign(requestHeaders, serviceHeaders);
    if (authToken) {
      requestHeaders['Authorization'] = `Bearer ${authToken}`;
    }
  }

  let body: BodyInit;
  if (prepared.bodyMode === 'multipart' && prepared.formFields) {
    const formData = new FormData();
    for (const [field, value] of Object.entries(prepared.formFields)) {
      formData.append(field, value);
    }
    formData.append(prepared.fileFieldName ?? 'file', blob, fileName);
    body = formData;
    // No Content-Type — fetch adds the multipart boundary.
  } else {
    body = blob;
    if (!requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'audio/mp3';
    }
  }

  return {
    method: prepared.method,
    body,
    headers: requestHeaders,
    credentials: prepared.attachAuth ? 'include' : 'omit',
  };
}

// Ask the main thread for a fresh upload_url and rebuild the request; fall back to current on failure.
async function refreshPreparedUpload(
  port: MessagePort,
  storageProvider: string,
  fileName: string,
  blob: Blob,
  current: PreparedUpload
): Promise<PreparedUpload> {
  sendToPort(port, { type: 'upload_url_required', fileName });
  const freshUpload = await waitForUploadUrlUpdate(port);
  if (!freshUpload) {
    return current;
  }
  try {
    return getStorageProvider(storageProvider).prepareUpload({ fileName, blob, upload: freshUpload });
  } catch {
    return current;
  }
}

// Upload with retry; on any non-401 error, refresh the (possibly expired) upload_url and retry.
async function uploadWithRetry(
  prepared: PreparedUpload,
  fileName: string,
  blob: Blob,
  serviceHeaders: Record<string, string>,
  storageProvider: string,
  sourcePort: MessagePort
): Promise<UploadResult> {
  let lastError = 'Upload failed after retries';
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(prepared.url, buildUploadInit(prepared, fileName, blob, serviceHeaders));

      if (response.ok) {
        return { success: true };
      }

      // Parse server error body for better error messages
      lastStatusCode = response.status;
      lastError = await parseErrorMessage(response);

      // Main-service auth failure (only when we attach our own Bearer token) — refresh token.
      // Presigned uploads (attachAuth=false) fall through to the upload_url refresh below.
      if (response.status === 401 && prepared.attachAuth) {
        broadcast({ type: 'token_required' });
        await waitForTokenUpdate();
        continue;
      }

      // Any other upload error (e.g. expired presigned URL → 403) — fetch a fresh
      // upload_url from the main thread and retry with it.
      if (attempt < DEFAULT_MAX_RETRIES) {
        prepared = await refreshPreparedUpload(sourcePort, storageProvider, fileName, blob, prepared);
        await sleep(DEFAULT_RETRY_DELAY_MS);
        continue;
      }

      return { success: false, error: lastError, statusCode: lastStatusCode };
    } catch (e: any) {
      lastError = e?.message ?? 'Network error';
      // Network error — refresh upload_url and retry.
      if (attempt < DEFAULT_MAX_RETRIES) {
        prepared = await refreshPreparedUpload(sourcePort, storageProvider, fileName, blob, prepared);
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
  storageProvider: string,
  upload: unknown,
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

    // Build the provider-specific request — failures reported as a failed upload.
    let prepared: PreparedUpload;
    try {
      prepared = getStorageProvider(storageProvider).prepareUpload({
        fileName,
        blob: encoded.blob,
        upload,
      });
    } catch (prepError: any) {
      sendToPort(sourcePort, {
        type: 'upload_failed',
        fileName,
        error: prepError?.message ?? 'Failed to prepare upload',
        chunkData: encoded.chunks,
      });
      return;
    }

    const result = await uploadWithRetry(
      prepared,
      fileName,
      encoded.blob,
      headers,
      storageProvider,
      sourcePort
    );

    if (result.success) {
      sendToPort(sourcePort, { type: 'upload_success', fileName });
    } else {
      sendToPort(sourcePort, {
        type: 'upload_failed',
        fileName,
        error: result.error ?? 'Upload failed after retries',
        // Send raw bytes, not the worker-owned Blob — the main thread rebuilds
        // a Blob it owns so the retry read can't fail with "Could not get blob data".
        chunkData: encoded.chunks,
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
        message.storageProvider,
        message.upload,
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

    case 'update_upload_url': {
      // Unblock every upload retry on this port waiting for a fresh upload_url
      resolveUploadUrlWaiters(sourcePort, message.upload);
      break;
    }

    case 'terminate': {
      // Clean up this port's resources
      const idx = ports.indexOf(sourcePort);
      if (idx >= 0) {
        ports.splice(idx, 1);
      }
      pendingUploadsPerPort.delete(sourcePort);
      // Unblock any upload retries still waiting on a refresh for this port
      resolveUploadUrlWaiters(sourcePort, null);
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
