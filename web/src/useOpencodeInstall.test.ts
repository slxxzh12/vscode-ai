import { describe, it, expect, vi, afterEach } from 'vitest';

function fresh() {
  vi.resetModules();
  return import('./useOpencodeInstall');
}

const sample = {
  supported: true,
  platform: 'win32',
  arch: 'x64',
  anyInstalled: false,
  installed: [],
  target: 'C:\\app\\soft\\opencode.exe',
  downloadUrl: 'https://example.test/opencode.zip',
  download: {
    state: 'downloading',
    downloaded: 50,
    total: 100,
    percent: 50,
    error: '',
    path: '',
    userPath: false,
    startedAt: 0,
    finishedAt: 0,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('useOpencodeInstall', () => {
  it('fetchOpencodeStatus loads /api/opencode/status', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => sample };
    }));
    const { fetchOpencodeStatus, useOpencodeInstall } = await fresh();
    const status = await fetchOpencodeStatus();
    expect(calls[0]).toBe('/api/opencode/status');
    expect(status?.download.percent).toBe(50);
    expect(useOpencodeInstall().status.value?.anyInstalled).toBe(false);
  });

  it('startOpencodeInstall posts to /api/opencode/install', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => sample };
    }));
    const { startOpencodeInstall } = await fresh();
    const status = await startOpencodeInstall();
    expect(calls[0].url).toBe('/api/opencode/install');
    expect(calls[0].init?.method).toBe('POST');
    expect(status?.download.state).toBe('downloading');
  });
});
