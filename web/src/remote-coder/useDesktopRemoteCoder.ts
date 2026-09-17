// 桌面端每 2s 取件：拿到即 ack（避免下一轮重复），再按 kind 派发窗口事件给 TerminalView。
export interface RemoteEntry { id: string; kind: 'screenshot' | 'message'; text?: string }

export interface DesktopRemoteDeps {
  fetch: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
  visibility: () => string;
  dispatch: (name: string, detail?: unknown) => void;
  intervalMs?: number;
}

const defaultDeps = (): Omit<DesktopRemoteDeps, 'intervalMs'> => ({
  fetch: (url, init) => fetch(url, init),
  visibility: () => (typeof document === 'undefined' ? 'visible' : document.visibilityState),
  dispatch: (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail })),
});

export function startDesktopRemoteCoder(overrides: Partial<DesktopRemoteDeps> = {}): () => void {
  const deps: DesktopRemoteDeps = { ...defaultDeps(), ...overrides };
  const intervalMs = deps.intervalMs ?? 2000;
  let stopped = false;
  let running = false;

  async function tickOnce() {
    if (stopped || running) return;
    if (deps.visibility() !== 'visible') return;   // 不可见不认领，等可见后补处理
    running = true;
    try {
      const res = await deps.fetch('/api/remote-coder/inbox');
      const data = await res.json().catch(() => ({}));
      const entries: RemoteEntry[] = Array.isArray(data?.entries) ? data.entries : [];
      if (!entries.length) return;
      await deps.fetch('/api/remote-coder/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: entries.map((e) => e.id) }),
      }).catch(() => { /* 回执失败不阻塞派发 */ });
      for (const e of entries) {
        if (e.kind === 'screenshot') deps.dispatch('df-remote-screen');
        else if (e.kind === 'message' && e.text) deps.dispatch('df-remote-send', { text: e.text });
      }
    } catch {
      /* 网络抖动：下一轮再试 */
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { void tickOnce(); }, intervalMs);
  void tickOnce();
  return () => { stopped = true; clearInterval(timer); };
}
