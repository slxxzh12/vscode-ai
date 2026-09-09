const TIMEOUT_MS = 10000;

export function makePeerClient({ timeoutMs = TIMEOUT_MS } = {}) {
  return {
    async post(host, port, envelope) {
      const url = `http://${host}:${port}/api/collab/peer`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 200) return { ok: false, error: `http-${res.status}` };
      const body = await res.json();
      return body; // { ok, data?, error? }
    },
  };
}
