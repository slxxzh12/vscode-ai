import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeLedgerSessions, fetchLedgerSessions } from './ledgerSessions';

afterEach(() => { vi.restoreAllMocks(); });

describe('ledgerSessions', () => {
  it('normalize 丢弃非法项', () => {
    expect(normalizeLedgerSessions({ sessions: [{ id: 's1', name: 'A', state: 'exited' }, null, { id: '' }] }).map((s) => s.id)).toEqual(['s1']);
    expect(normalizeLedgerSessions('nope')).toEqual([]);
  });

  it('fetch 命中返回数组，异常返回空数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's1', name: 'A' }] }) })));
    expect((await fetchLedgerSessions()).map((s) => s.id)).toEqual(['s1']);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await fetchLedgerSessions()).toEqual([]);
  });
});
