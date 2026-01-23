import { SDKEvent, SDKEventType } from '../types';

export class EventEmitter {
  private listeners: Map<SDKEventType, Set<(event: SDKEvent) => void>>;

  constructor() {
    this.listeners = new Map();
  }

  on(eventType: SDKEventType, listener: (event: SDKEvent) => void): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)?.add(listener);
  }

  off(eventType: SDKEventType, listener: (event: SDKEvent) => void): void {
    this.listeners.get(eventType)?.delete(listener);
  }

  emit(event: SDKEvent): void {
    // Emit to specific event listeners
    this.listeners.get(event.type)?.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    });

    // Emit to 'all' listeners? If we want wildcard support.
    // For now, simple implementation.
  }
}
