export function createKeyPool({ cooldownMs = 30000, now = Date.now } = {}) {
  const idx = new Map();
  const cooling = new Map();

  function coolingFor(providerId) {
    let m = cooling.get(providerId);
    if (!m) { m = new Map(); cooling.set(providerId, m); }
    return m;
  }
  function prune(providerId) {
    const m = coolingFor(providerId);
    const t = now();
    for (const [key, until] of m) if (until <= t) m.delete(key);
    return m;
  }

  return {
    next(providerId, keys) {
      const list = (keys || []).filter(Boolean);
      if (!list.length) return '';
      const m = prune(providerId);
      const start = idx.get(providerId) || 0;
      for (let attempt = 0; attempt < list.length; attempt += 1) {
        const at = (start + attempt) % list.length;
        const key = list[at];
        if (!m.has(key)) {
          idx.set(providerId, (at + 1) % list.length);
          return key;
        }
      }
      let best = list[0];
      let bestUntil = Infinity;
      for (const key of list) {
        const until = m.get(key) || 0;
        if (until < bestUntil) { bestUntil = until; best = key; }
      }
      idx.set(providerId, (list.indexOf(best) + 1) % list.length);
      return best;
    },
    cool(providerId, key, ms = cooldownMs) {
      if (!key) return;
      coolingFor(providerId).set(key, now() + ms);
    },
    isCooling(providerId, key) {
      return prune(providerId).has(key);
    },
    clear() { idx.clear(); cooling.clear(); },
  };
}
