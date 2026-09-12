import { describe, it, expect, vi } from 'vitest';
import { snapshotFileName } from './snapshot';

describe('snapshotFileName', () => {
  it('固定日期 → devflow-YYYYMMDD-HHmmss.png（各段补零）', () => {
    const d = new Date(2026, 8, 12, 9, 30, 5);
    expect(snapshotFileName(d)).toBe('devflow-20260912-093005.png');
  });

  it('月在个位时补零', () => {
    const d = new Date(2026, 0, 3, 0, 0, 0);
    expect(snapshotFileName(d)).toBe('devflow-20260103-000000.png');
  });
});
