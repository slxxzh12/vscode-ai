import { describe, it, expect } from 'vitest';
import { sortText, dedupText } from './textTools';

describe('sortText', () => {
  it('asc / desc', () => {
    expect(sortText('b\na\nc', 'asc')).toBe('a\nb\nc');
    expect(sortText('b\na\nc', 'desc')).toBe('c\nb\na');
  });
  it('case-insensitive asc/desc', () => {
    expect(sortText('B\na\nC', 'asc-ci')).toBe('a\nB\nC');
    expect(sortText('B\na\nC', 'desc-ci')).toBe('C\nB\na');
  });
  it('numeric by leading number, non-numeric last', () => {
    expect(sortText('10\n2\nx\n1', 'num-asc')).toBe('1\n2\n10\nx');
    expect(sortText('10\n2\nx\n1', 'num-desc')).toBe('x\n10\n2\n1');
  });
  it('keeps the trailing newline', () => {
    expect(sortText('b\na\n', 'asc')).toBe('a\nb\n');
  });
});

describe('dedupText', () => {
  it('dedupes trimmed lines and sorts case-insensitively', () => {
    expect(dedupText('b\n a \nB\n\nc')).toBe('\na\nb\nB\nc');
  });
  it('keeps a single blank line and the trailing newline', () => {
    expect(dedupText('x\n\nx\n')).toBe('\nx\n');
  });
});
