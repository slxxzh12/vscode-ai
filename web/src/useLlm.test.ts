import { describe, it, expect, vi, afterEach } from 'vitest';
import { useLlm } from './useLlm';

type Call = { url: string; init?: RequestInit };

function stub(handler: (url: string, init?: RequestInit) => { ok?: boolean; status?: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? {} };
  }));
  return calls;
}

describe('useLlm', () => {
  afterEach(() => vi.unstubAllGlobals());
  const llm = useLlm();

  it('status/tokens/plugins 走 GET', async () => {
    const calls = stub((url) => {
      if (url.endsWith('/status')) return { body: { enabled: true } };
      if (url.endsWith('/tokens')) return { body: { tokens: [{ id: 't' }] } };
      return { body: { entries: [] } };
    });
    expect((await llm.status()).enabled).toBe(true);
    expect((await llm.tokens()).tokens).toHaveLength(1);
    await llm.plugins();
    expect(calls.every((c) => (c.init?.method || 'GET') === 'GET')).toBe(true);
  });

  it('vault/secret/enabled/plugins 动作走 POST', async () => {
    const calls = stub(() => ({ body: { ok: true } }));
    await llm.vaultInit('p');
    await llm.vaultUnlock('p');
    await llm.vaultLock();
    await llm.vaultPassphrase('a', 'b');
    await llm.vaultReset();
    await llm.setSecret('s');
    await llm.regenerateSecret();
    await llm.setEnabled(true);
    await llm.issue('e', 7);
    await llm.createPluginExample();
    await llm.revealPlugins();
    await llm.reloadPlugins();
    expect(calls).toHaveLength(12);
    expect(calls.every((c) => c.init?.method === 'POST')).toBe(true);
    expect(calls[0].url).toBe('/api/llm-admin/vault/init');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ passphrase: 'p' });
    expect(JSON.parse(String(calls[8].init?.body))).toEqual({ employeeId: 'e', days: 7 });
  });

  it('revoke 走 DELETE 并编码 id', async () => {
    const calls = stub(() => ({ body: { ok: true } }));
    await llm.revoke('a/b');
    expect(calls[0].url).toBe('/api/llm-admin/tokens/a%2Fb');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('config 把选择拼成 pid/model 查询串', async () => {
    const calls = stub(() => ({ body: { config: 'cfg' } }));
    const r = await llm.config('tok', [{ id: 'p1', models: ['m1', 'm2'] }, { id: 'p2', models: ['m3'] }]);
    expect(r.config).toBe('cfg');
    expect(calls[0].url).toBe('/api/llm-admin/opencode-config?token=tok&pid=p1&model=m1&pid=p1&model=m2&pid=p2&model=m3');
  });

  it('非 2xx 抛错：优先 message/error，否则 HTTP 状态', async () => {
    stub(() => ({ ok: false, status: 400, body: { message: 'bad' } }));
    await expect(llm.status()).rejects.toThrow('bad');
    stub(() => ({ ok: false, status: 500, body: { error: 'oops' } }));
    await expect(llm.status()).rejects.toThrow('oops');
    stub(() => ({ ok: false, status: 503, body: {} }));
    await expect(llm.status()).rejects.toThrow('HTTP 503');
  });

  it('opencodeConfig 走 GET，saveOpencodeConfig 走 POST', async () => {
    const calls = stub(() => ({ body: { ok: true, config: { provider: {} } } }));
    await llm.opencodeConfig();
    expect(calls[0].url).toBe('/api/llm-admin/opencode');
    expect(calls[0].init?.method || 'GET').toBe('GET');
    await llm.saveOpencodeConfig({ provider: { a: {} }, model: 'a/m' });
    expect(calls[1].url).toBe('/api/llm-admin/opencode');
    expect(calls[1].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ provider: { a: {} }, model: 'a/m' });
  });
});
