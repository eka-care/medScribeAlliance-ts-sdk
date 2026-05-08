/**
 * Re-export ITransport and related types from the central types module.
 *
 * This file exists so that transport implementations can import from
 * a co-located module (`./transport.interface`) rather than reaching
 * into `../types`. Consumers of the SDK import types from `types/index`.
 */

export type {
  ITransport,
  TransportRequest,
  TransportResponse,
  IpcBridge,
  IpcRequest,
  IpcResponse,
} from '../types';
