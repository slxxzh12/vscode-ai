import { describe, expect, it } from 'vitest';
import { extractTable } from '../src/vue/table-renderer';

describe('extractTable', () => {
  it('extracts headers and rows', () => {
    const el = document.createElement('table');
    el.innerHTML = '<thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
    expect(extractTable(el)).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] });
  });

  it('returns null for nested tables', () => {
    const el = document.createElement('table');
    el.innerHTML = '<thead><tr><th>a</th></tr></thead><tbody><tr><td><table><tr><td>x</td></tr></table></td></tr></tbody>';
    expect(extractTable(el)).toBeNull();
  });
});
