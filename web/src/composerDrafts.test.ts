import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearComposerDrafts, draftKey, getComposerDraft, setComposerDraft } from './composerDrafts';

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  });
  clearComposerDrafts();
});

describe('composerDrafts', () => {
  it('按会话保存与恢复提示词草稿', () => {
    setComposerDraft('s1', 'hello');
    setComposerDraft('s2', 'world');
    expect(getComposerDraft('s1')).toBe('hello');
    expect(getComposerDraft('s2')).toBe('world');
    setComposerDraft('s1', '');
    expect(getComposerDraft('s1')).toBe('');
    expect(getComposerDraft('s2')).toBe('world');
  });

  it('没有会话时使用统一兜底键', () => {
    setComposerDraft(null, 'draft');
    expect(getComposerDraft(null)).toBe('draft');
    expect(getComposerDraft(undefined)).toBe('draft');
    expect(draftKey(undefined)).toBe('__none__');
  });

  it('过长草稿只保留尾部', () => {
    const long = 'x' + 'a'.repeat(100_005);
    setComposerDraft('s', long);
    expect(getComposerDraft('s')).toHaveLength(100_000);
    expect(getComposerDraft('s')).toBe(long.slice(-100_000));
  });
});
