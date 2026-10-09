import { describe, it, expect } from 'vitest';
import { isDbExt, shouldOpenInNavicat, uniqueConnName } from './sqliteFile';

describe('sqliteFile', () => {
  it('isDbExt 命中常见扩展名且大小写不敏感', () => {
    for (const n of ['a.db', 'a.sqlite', 'a.sqlite3', 'a.db3', 'A.DB']) expect(isDbExt(n)).toBe(true);
    for (const n of ['a.ts', 'a.txt', 'adb', 'a.dbs']) expect(isDbExt(n)).toBe(false);
  });

  it('shouldOpenInNavicat：扩展名或内容头命中', () => {
    expect(shouldOpenInNavicat('a.txt', true)).toBe(true);
    expect(shouldOpenInNavicat('a.db', false)).toBe(true);
    expect(shouldOpenInNavicat('a.ts', false)).toBe(false);
  });

  it('uniqueConnName 冲突时追加序号', () => {
    expect(uniqueConnName('a.db', [])).toBe('a.db');
    expect(uniqueConnName('a.db', ['a.db'])).toBe('a.db (2)');
    expect(uniqueConnName('a.db', ['a.db', 'a.db (2)'])).toBe('a.db (3)');
  });
});
