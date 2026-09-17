import { describe, it, expect, vi, afterEach } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('./theme');
}

function stubStorage(store: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
}

function stubDom() {
  const toggles: boolean[] = [];
  const root = {
    dataset: {} as Record<string, string>,
    classList: { toggle: (_c: string, on: boolean) => { toggles.push(on); } },
  };
  vi.stubGlobal('document', {
    createElement: () => ({ style: {}, content: {}, setAttribute() {} }),
    documentElement: root,
  });
  return { root, toggles };
}

describe('theme', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('localStorage 存 light → light，并落盘', async () => {
    const store: Record<string, string> = { 'devflow-theme': 'light' };
    stubStorage(store);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    stubDom();
    const { useTheme } = await fresh();
    expect(useTheme().theme.value).toBe('light');
    expect(store['devflow-theme']).toBe('light');
  });

  it('无存储但系统浅色 → light', async () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    stubDom();
    const { useTheme } = await fresh();
    expect(useTheme().theme.value).toBe('light');
  });

  it('默认 dark；toggle 切换、写 dataset 与落盘', async () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const { root } = stubDom();

    const { useTheme } = await fresh();
    const t = useTheme();
    expect(t.theme.value).toBe('dark');
    expect(t.isDark.value).toBe(true);
    expect(root.dataset.theme).toBe('dark');
    expect(store['devflow-theme']).toBe('dark');

    t.toggle();
    expect(t.theme.value).toBe('light');
    expect(t.isDark.value).toBe(false);
    expect(root.dataset.theme).toBe('light');
    expect(store['devflow-theme']).toBe('light');

    t.toggle();
    expect(t.theme.value).toBe('dark');
  });
});
