/**
 * SDK configuration types
 */

import { TransportMode } from '../constants';
import { IpcBridge } from './transport';

export interface ScribeSDKConfig {
  /** Base URL of the scribe service (required) */
  baseUrl: string;

  /** Bearer token authentication */
  accessToken?: string;

  /** Transport mode: 'direct' (HTTP fetch) or 'ipc' (Electron IPC). Default: 'direct' */
  mode?: TransportMode;

  /** IPC bridge — required when mode is 'ipc' */
  ipcTransport?: IpcBridge;

  /** SharedWorker config: true (require), false (disable), 'auto' (detect). Default: 'auto' */
  useWorker?: boolean | 'auto';

  /** URL to the worker.bundle.js file. Use getWorkerUrl() or createWorkerBlobUrl() to resolve. */
  workerScriptUrl?: string;

  /** Enable debug logging. Default: false */
  debug?: boolean;

  /** Auto-fetch discovery document on init. Default: true */
  autoDiscovery?: boolean;
}
