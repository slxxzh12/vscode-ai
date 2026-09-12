import crypto from 'node:crypto';

export function normalizeBody(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? '' : String(body));
  const text = buf.toString('utf8');
  try {
    return JSON.stringify(sortDeep(JSON.parse(text)));
  } catch {
    return buf.toString('base64');
  }
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

export function cacheKey(providerId, method, body) {
  return crypto.createHash('sha256')
    .update(`${providerId}\n${String(method || 'GET').toUpperCase()}\n${normalizeBody(body)}`)
    .digest('hex');
}

function bodyBytes(value) {
  if (!value) return 0;
  if (Buffer.isBuffer(value.body)) return value.body.length;
  return Buffer.byteLength(String(value.body == null ? '' : value.body));
}

export function createCache({ ttlMs = 10 * 60 * 1000, maxEntries = 256, maxBytes = 64 * 1024 * 1024 } = {}) {
  const map = new Map();
  let bytes = 0;
  let seq = 0;
  const counters = { hits: 0, misses: 0 };

  function drop(key) {
    const entry = map.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    map.delete(key);
  }
  function evict() {
    while (map.size > maxEntries || bytes > maxBytes) {
      let oldestKey = null;
      let oldest = Infinity;
      for (const [k, e] of map) if (e.used < oldest) { oldest = e.used; oldestKey = k; }
      if (oldestKey === null) break;
      drop(oldestKey);
    }
  }

  return {
    keyFor: cacheKey,
    get(key, { now = Date.now() } = {}) {
      const entry = map.get(key);
      if (!entry) { counters.misses += 1; return undefined; }
      if (entry.expiresAt <= now) { drop(key); counters.misses += 1; return undefined; }
      entry.used = ++seq;
      counters.hits += 1;
      return entry.value;
    },
    set(key, value, ttl = ttlMs) {
      const size = bodyBytes(value);
      if (size > maxBytes) return false;
      drop(key);
      map.set(key, { value, expiresAt: Date.now() + ttl, bytes: size, used: ++seq });
      bytes += size;
      evict();
      return true;
    },
    clear() { map.clear(); bytes = 0; },
    stats() { return { entries: map.size, bytes, ...counters }; },
  };
}
