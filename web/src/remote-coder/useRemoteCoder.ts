// 手机侧 HTTP 客户端：请求截图、发消息、取图版本、等待新图。fetch 可注入以便单测。
export interface FetchLike {
  (url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
}
export interface RemoteDeps { fetch: FetchLike }

const realFetch: FetchLike = (url, init) => fetch(url, init);

async function postJson(path: string, body: unknown, deps: RemoteDeps): Promise<any> {
  const res = await deps.fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

export async function requestShot(deps: RemoteDeps = { fetch: realFetch }): Promise<void> {
  await postJson('/api/remote-coder/message', { kind: 'screenshot' }, deps);
}

export async function sendRemoteMessage(text: string, deps: RemoteDeps = { fetch: realFetch }): Promise<void> {
  await postJson('/api/remote-coder/message', { kind: 'message', text }, deps);
}

export async function fetchScreenRev(deps: RemoteDeps = { fetch: realFetch }): Promise<string> {
  try {
    const res = await deps.fetch('/api/remote-coder/state');
    const data = await res.json().catch(() => ({}));
    return typeof data?.rev === 'string' ? data.rev : '';
  } catch {
    return '';
  }
}

export function screenUrl(rev: string): string {
  return `/api/remote-coder/screen.png?v=${encodeURIComponent(rev)}`;
}

export interface RemoteInfo { dir: string; messagesFile: string }

export async function fetchRemoteInfo(deps: RemoteDeps = { fetch: realFetch }): Promise<RemoteInfo> {
  try {
    const res = await deps.fetch('/api/remote-coder/info');
    const data = await res.json().catch(() => ({}));
    return {
      dir: typeof data?.dir === 'string' ? data.dir : '',
      messagesFile: typeof data?.messagesFile === 'string' ? data.messagesFile : '',
    };
  } catch {
    return { dir: '', messagesFile: '' };
  }
}

export async function appendMessages(
  text: string,
  deps: RemoteDeps = { fetch: realFetch },
): Promise<{ added: number; ids: string[] }> {
  const data = await postJson('/api/remote-coder/messages', { text }, deps);
  return { added: Number(data?.added) || 0, ids: Array.isArray(data?.ids) ? data.ids : [] };
}

export interface WaitOptions extends Partial<RemoteDeps> {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForNewScreen(prevRev: string, opts: WaitOptions = {}): Promise<{ rev: string } | null> {
  const deps: RemoteDeps = { fetch: opts.fetch ?? realFetch };
  const timeoutMs = opts.timeoutMs ?? 15000;
  const intervalMs = opts.intervalMs ?? 2000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rev = await fetchScreenRev(deps);
    if (rev && rev !== prevRev) return { rev };
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
