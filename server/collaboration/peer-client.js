const TIMEOUT_MS = 10000;

export function makePeerClient({ timeoutMs = TIMEOUT_MS } = {}) {
  return {
    async post(host, port, envelope, extraHeaders = null, path = '/api/collab/peer') {
      const url = `http://${host}:${port}${path}`;
      const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 200) return { ok: false, error: `http-${res.status}` };
      const body = await res.json();
      return body; // { ok, data?, error? }
    },
  };
}
