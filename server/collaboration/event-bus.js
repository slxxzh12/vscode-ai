export function createEventBus() {
  const handlers = new Map();
  return {
    on(type, fn) { let s = handlers.get(type); if (!s) { s = new Set(); handlers.set(type, s); } s.add(fn); return () => s.delete(fn); },
    emit(type, payload) { const s = handlers.get(type); if (s) for (const fn of s) { try { fn(payload); } catch { /* noop */ } } },
  };
}
