// Minimal event emitter used by Race (and anything else that wants pub/sub).
export class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (set) for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${type}" threw`, err);
      }
    }
    const any = this._handlers.get('*');
    if (any) for (const fn of [...any]) fn({ type, payload });
  }

  clear() {
    this._handlers.clear();
  }
}
