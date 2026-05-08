/**
 * CallbackRegistry — typed registry for 6 grouped SDK callbacks.
 *
 * Each callback name maps to a specific event type via CallbackMap.
 * Multiple handlers can be registered per callback name.
 * Handler invocations are wrapped in try/catch so a bad consumer
 * handler never crashes the SDK.
 */

import { CallbackMap, CallbackName } from '../types';

export class CallbackRegistry {
  // Internally store handlers as Set<Function> keyed by callback name.
  // Type safety is enforced at the public API boundary (register/remove/dispatch).
  private handlers = new Map<CallbackName, Set<Function>>();

  /**
   * Register a handler for a callback name.
   * The same handler reference won't be added twice.
   */
  register<K extends CallbackName>(name: K, handler: CallbackMap[K]): void {
    if (!this.handlers.has(name)) {
      this.handlers.set(name, new Set());
    }
    this.handlers.get(name)!.add(handler);
  }

  /**
   * Remove a previously registered handler.
   */
  remove<K extends CallbackName>(name: K, handler: CallbackMap[K]): void {
    const set = this.handlers.get(name);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * Remove all handlers for a specific callback name,
   * or all handlers entirely if no name is provided.
   */
  removeAll(name?: CallbackName): void {
    if (name) {
      this.handlers.delete(name);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Dispatch an event to all registered handlers for the given callback name.
   * Each handler is invoked in a try/catch — one failing handler does not
   * prevent other handlers from executing.
   */
  dispatch<K extends CallbackName>(name: K, event: Parameters<CallbackMap[K]>[0]): void {
    const set = this.handlers.get(name);
    if (!set || set.size === 0) {
      return;
    }

    for (const handler of set) {
      try {
        handler(event);
      } catch (error) {
        console.error(`[ScribeSDK] Error in '${name}' callback handler:`, error);
      }
    }
  }

  /**
   * Check if any handlers are registered for a callback name.
   */
  hasHandlers(name: CallbackName): boolean {
    const set = this.handlers.get(name);
    return set !== undefined && set.size > 0;
  }
}
