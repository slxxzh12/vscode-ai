import { describe, it, expect } from 'vitest';
import { diffText, myers } from './diff';

function kinds(r: ReturnType<typeof diffText>) {
  return r.rows.map((row) => row.kind);
}

describe('myers', () => {
  it('identical arrays → all equal', () => {
    const ops = myers([1, 2, 3], [1, 2, 3], (x, y) => x === y);
    expect(ops.every((o) => o.type === 'equal')).toBe(true);
    expect(ops.map((o) => o.item)).toEqual([1, 2, 3]);
  });

  it('single insertion', () => {
    const ops = myers(['a', 'c'], ['a', 'b', 'c'], (x, y) => x === y);
    expect(ops.map((o) => `${o.type}:${o.item}`)).toEqual(['equal:a', 'ins:b', 'equal:c']);
  });

  it('single deletion', () => {
    const ops = myers(['a', 'b', 'c'], ['a', 'c'], (x, y) => x === y);
    expect(ops.map((o) => `${o.type}:${o.item}`)).toEqual(['equal:a', 'del:b', 'equal:c']);
  });

  it('empty vs non-empty', () => {
    expect(myers([], ['x'], (a, b) => a === b).map((o) => o.type)).toEqual(['ins']);
    expect(myers(['x'], [], (a, b) => a === b).map((o) => o.type)).toEqual(['del']);
  });

  it('completely different', () => {
    const ops = myers(['a'], ['b'], (x, y) => x === y);
    expect(ops.map((o) => o.type).sort()).toEqual(['del', 'ins']);
  });
});

describe('diffText', () => {
  it('identical text → all equal', () => {
    const r = diffText('a\nb\nc', 'a\nb\nc');
    expect(kinds(r)).toEqual(['equal', 'equal', 'equal']);
    expect(r.added + r.removed + r.changed).toBe(0);
  });

  it('one line changed', () => {
    const r = diffText('a\nb\nc', 'a\nx\nc');
    expect(kinds(r)).toEqual(['equal', 'change', 'equal']);
    const chg = r.rows[1];
    expect(chg.kind).toBe('change');
    expect(chg.left!.map((s) => s.text).join('')).toBe('b');
    expect(chg.right!.map((s) => s.text).join('')).toBe('x');
    expect(chg.left!.some((s) => s.changed)).toBe(true);
    expect(chg.right!.some((s) => s.changed)).toBe(true);
    expect(r.changed).toBe(1);
  });

  it('insertion of lines', () => {
    const r = diffText('a\nc', 'a\nb\nc');
    expect(kinds(r)).toEqual(['equal', 'ins', 'equal']);
    expect(r.added).toBe(1);
  });

  it('deletion of lines', () => {
    const r = diffText('a\nb\nc', 'a\nc');
    expect(kinds(r)).toEqual(['equal', 'del', 'equal']);
    expect(r.removed).toBe(1);
  });

  it('empty vs non-empty', () => {
    const r = diffText('', 'hello');
    expect(kinds(r)).toEqual(['ins']);
    expect(r.added).toBe(1);
    const r2 = diffText('hello', '');
    expect(kinds(r2)).toEqual(['del']);
  });

  it('preserves line numbers', () => {
    const r = diffText('a\nb\nc', 'a\nx\nc');
    expect(r.rows.map((row) => row.leftLine)).toEqual([1, 2, 3]);
    expect(r.rows.map((row) => row.rightLine)).toEqual([1, 2, 3]);
  });

  it('mixed change + insert + delete', () => {
    const r = diffText('one\ntwo\nthree', 'one\nthree\nfour');
    // one equal; two deleted; three equal; four inserted
    expect(kinds(r)).toEqual(['equal', 'del', 'equal', 'ins']);
    expect(r.removed).toBe(1);
    expect(r.added).toBe(1);
  });

  it('inline word-level spans mark only differing words', () => {
    const r = diffText('foo bar baz', 'foo qux baz');
    const chg = r.rows.find((row) => row.kind === 'change')!;
    const leftChanged = chg.left!.filter((s) => s.changed).map((s) => s.text).join('');
    const rightChanged = chg.right!.filter((s) => s.changed).map((s) => s.text).join('');
    expect(leftChanged).toBe('bar');
    expect(rightChanged).toBe('qux');
  });

  it('trailing newline is insignificant', () => {
    expect(kinds(diffText('x\n', 'x'))).toEqual(['equal']);
    expect(kinds(diffText('a\nb\n', 'a\nb'))).toEqual(['equal', 'equal']);
  });
});
