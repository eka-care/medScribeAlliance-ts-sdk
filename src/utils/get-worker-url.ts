/**
 * Utility to resolve the SharedWorker bundle URL.
 *
 * The SDK ships a separate `dist/worker.bundle.js` file that must be
 * served as a standalone script for the SharedWorker to load.
 *
 * Consumers pass the resolved URL via `ScribeSDKConfig.workerScriptUrl`
 * or in `WorkerManagerConfig.workerScriptUrl`.
 *
 * Resolution order:
 * 1. Global override: `window.__MEDSCRIBE_WORKER_URL__`
 * 2. Auto-detect from the script tag that loaded this module
 * 3. Default: `/worker.bundle.js` (consumer must serve it at this path)
 */

const WORKER_FILE_NAME = 'worker.bundle.js';

declare global {
  interface Window {
    __MEDSCRIBE_WORKER_URL__?: string;
  }
}

/**
 * Returns the best-guess URL for the SharedWorker bundle.
 *
 * @example
 * ```ts
 * import { ScribeClient, getWorkerUrl } from 'med-scribe-alliance-ts-sdk';
 *
 * const client = new ScribeClient({
 *   baseUrl: 'https://api.example.com',
 *   workerScriptUrl: getWorkerUrl(),
 * });
 * ```
 *
 * @example
 * ```ts
 * // Global override (set before SDK loads)
 * window.__MEDSCRIBE_WORKER_URL__ = '/assets/worker.bundle.js';
 * ```
 *
 * @example
 * ```ts
 * // CDN blob URL (works around CORS restrictions on SharedWorker)
 * const workerUrl = await createWorkerBlobUrl();
 * ```
 */
export function getWorkerUrl(): string {
  // 1. Global override
  if (typeof window !== 'undefined' && window.__MEDSCRIBE_WORKER_URL__) {
    return window.__MEDSCRIBE_WORKER_URL__;
  }

  // 2. Auto-detect from current script location
  if (typeof document !== 'undefined' && document.currentScript) {
    const src = (document.currentScript as HTMLScriptElement).src;
    if (src) {
      return src.substring(0, src.lastIndexOf('/') + 1) + WORKER_FILE_NAME;
    }
  }

  // 3. Default — consumer must ensure worker.bundle.js is served here
  return `/${WORKER_FILE_NAME}`;
}

/**
 * Fetches the worker script from a URL and creates a blob URL.
 * Useful when the worker file is on a CDN (SharedWorker requires same-origin).
 *
 * @param url - URL to fetch the worker script from.
 *              Defaults to jsDelivr CDN for this package.
 * @returns A blob URL that can be used as workerScriptUrl
 *
 * @example
 * ```ts
 * const workerUrl = await createWorkerBlobUrl();
 * const client = new ScribeClient({
 *   baseUrl: 'https://api.example.com',
 *   workerScriptUrl: workerUrl,
 * });
 * ```
 */
export async function createWorkerBlobUrl(url?: string): Promise<string> {
  const fetchUrl =
    url ?? `https://cdn.jsdelivr.net/npm/med-scribe-alliance-ts-sdk/dist/${WORKER_FILE_NAME}`;

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch worker script: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const blob = new Blob([text], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}
