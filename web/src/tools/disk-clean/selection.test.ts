// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defaultSelection, selectionTotals, missingRiskyConfirmations, formatBytes } from './selection';
import type { DiskCategory } from './types';

const cat = (p: Partial<DiskCategory>): DiskCategory => ({
  id: 'x', group: 'app', risk: 'safe', defaultChecked: true, needsAdmin: false,
  status: 'done', bytes: 0, files: 0, truncated: false, error: null, ...p,
});

describe('disk-clean selection', () => {
  it('默认只勾选 safe 类别', () => {
    const cats = [cat({ id: 'a' }), cat({ id: 'b', risk: 'caution', defaultChecked: false }), cat({ id: 'c', risk: 'risky', defaultChecked: false })];
    expect([...defaultSelection(cats)]).toEqual(['a']);
  });

  it('汇总已选类别的字节与数量', () => {
    const cats = [cat({ id: 'a', bytes: 10 }), cat({ id: 'b', bytes: 20 })];
    const r = selectionTotals(cats, new Set(['a', 'b']));
    expect(r).toEqual({ count: 2, bytes: 30 });
  });

  it('risky 类别缺少确认时返回 id 列表', () => {
    const cats = [cat({ id: 'r', risk: 'risky', defaultChecked: false }), cat({ id: 's' })];
    expect(missingRiskyConfirmations(cats, new Set(['r', 's']), new Set(['s']))).toEqual(['r']);
    expect(missingRiskyConfirmations(cats, new Set(['r', 's']), new Set(['r', 's']))).toEqual([]);
  });

  it('formatBytes 走人类可读单位', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });
});
