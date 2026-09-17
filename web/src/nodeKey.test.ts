import { describe, it, expect, vi, afterEach } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('./nodeKey');
}

describe('nodeFp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('有公钥 → sha256 前 8 字节 hex', async () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----';
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ identity: { publicKey: pem } }) })));
    const { nodeFp } = await fresh();
    expect(await nodeFp()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('无公钥 → none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) })));
    const { nodeFp } = await fresh();
    expect(await nodeFp()).toBe('none');
  });

  it('请求失败 → none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x'); }));
    const { nodeFp } = await fresh();
    expect(await nodeFp()).toBe('none');
  });

  it('结果缓存：多次调用只请求一次', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls += 1; return { json: async () => ({}) }; }));
    const { nodeFp } = await fresh();
    await nodeFp();
    await nodeFp();
    expect(calls).toBe(1);
  });
});
