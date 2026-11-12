import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultDocPaths, joinRoot, detectDocDefaults } from './docDefaults';

function ok(data: unknown) { return { ok: true, statusText: 'OK', json: async () => data } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ok({ paths: { skills: '/repo/.opencode/skills' } })));
});

describe('docDefaults', () => {
  it('Windows 根目录套用文档仓默认结构', () => {
    expect(joinRoot('D:\\root\\devflow\\devflow', 'docs/knowledge')).toBe('D:\\root\\devflow\\devflow\\docs\\knowledge');
    const p = defaultDocPaths('D:\\root\\devflow\\devflow');
    expect(p.knowledge).toBe('D:\\root\\devflow\\devflow\\docs\\knowledge');
    expect(p.solution).toBe('D:\\root\\devflow\\devflow\\docs\\version');
    expect(p.workflow).toBe('D:\\root\\devflow\\devflow\\docs\\learn');
    expect(p.experience).toBe('D:\\root\\devflow\\devflow\\docs\\memory');
    expect(p.skills).toBe('D:\\root\\devflow\\devflow\\skills');
    expect(p.rules).toBe('D:\\root\\devflow\\devflow\\docs\\rules');
  });

  it('POSIX 根目录套用文档仓默认结构', () => {
    const p = defaultDocPaths('/work/devflow/');
    expect(p.knowledge).toBe('/work/devflow/docs/knowledge');
    expect(p.solution).toBe('/work/devflow/docs/version');
    expect(p.skills).toBe('/work/devflow/skills');
  });

  it('调用后端识别仓库里的配置目录', async () => {
    const r = await detectDocDefaults('D:\\repo');
    expect(r.paths.skills).toBe('/repo/.opencode/skills');
    expect(fetch).toHaveBeenCalledWith('/api/pipeline/defaults?root=D%3A%5Crepo');
  });
});
