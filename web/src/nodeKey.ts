// 节点公钥指纹（sha256 前 16 hex）：用于按实例隔离 localStorage 配置
let cached: Promise<string> | null = null;
export function nodeFp(): Promise<string> {
  if (!cached) {
    cached = fetch('/api/collab/snapshot')
      .then((r) => r.json())
      .then(async (s) => {
        const pem: string = s?.identity?.publicKey || '';
        if (!pem) return 'none';
        try {
          const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pem));
          return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch { return 'none'; }
      })
      .catch(() => 'none');
  }
  return cached;
}
