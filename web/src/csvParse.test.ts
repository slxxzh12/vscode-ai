import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple CSV with BOM and CRLF', () => {
    const r = parseCsv('\uFEFFa,b\r\n1,2\r\n3,4\r\n');
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('handles quoted commas, escaped quotes and newlines', () => {
    const r = parseCsv('"a,b","c""d"\n"x\ny",z\n');
    expect(r.headers).toEqual(['a,b', 'c"d']);
    expect(r.rows).toEqual([['x\ny', 'z']]);
  });

  it('pads uneven rows and extends headers to the widest row', () => {
    const r = parseCsv('a,b\n1,2,3\n4\n');
    expect(r.headers).toEqual(['a', 'b', '']);
    expect(r.rows).toEqual([['1', '2', '3'], ['4', '', '']]);
  });

  it('skips blank lines and handles header-only files', () => {
    expect(parseCsv('a\n\n1\n')).toEqual({ headers: ['a'], rows: [['1']] });
    expect(parseCsv('a,b\n')).toEqual({ headers: ['a', 'b'], rows: [] });
  });

  it('returns empty model for empty text', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv('  ')).toEqual({ headers: ['  '], rows: [] });
  });
});
