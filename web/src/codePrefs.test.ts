import { describe, it, expect } from 'vitest';
import { mergePrefs, defaultPrefs } from './codePrefs';

describe('mergePrefs', () => {
  it('缺键/类型不符 → 用默认值', () => {
    const base = defaultPrefs();
    expect(mergePrefs(null, base)).toEqual(base);
    expect(mergePrefs({ exts: 42, excludeTestFiles: 'yes', nope: 1 }, base)).toEqual(base);
  });
  it('已保存的值覆盖默认值', () => {
    const base = defaultPrefs();
    const r = mergePrefs({ exts: '.js', excludeTestFiles: false, codeOnly: false, hugeCommitLimit: '500' }, base);
    expect(r.exts).toBe('.js');
    expect(r.excludeTestFiles).toBe(false);
    expect(r.codeOnly).toBe(false);
    expect(r.hugeCommitLimit).toBe('500');
    expect(r.excludeDirs).toBe(base.excludeDirs);
  });
});

describe('defaultPrefs', () => {
  it('默认含 sql/xml 后缀与 node_modules 排除目录', () => {
    const p = defaultPrefs();
    expect(p.exts).toContain('.sql');
    expect(p.exts).toContain('.xml');
    expect(p.excludeDirs).toContain('node_modules');
    expect(p.excludeTestFiles).toBe(true);
    expect(p.codeOnly).toBe(true);
  });
});
