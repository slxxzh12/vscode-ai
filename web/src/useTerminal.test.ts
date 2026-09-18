import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTerminal } from './useTerminal';
import { C2S, S2C } from '@devflow/shared';

class FakeSocket {
  static OPEN = 1;
  readyState: number = FakeSocket.OPEN;
  listeners: Record<string, ((e: any) => void)[]> = {};
  sent: any[] = [];
  closed = false;
  constructor(public url: string) {}
  addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type: string, fn: any) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; }
  fire(type: string, payload?: any) { (this.listeners[type] || []).forEach((f) => f(payload)); }
  emitMessage(msg: any) { this.fire('message', { data: JSON.stringify(msg) }); }
  emitOpen() { this.readyState = FakeSocket.OPEN; this.fire('open'); }
  emitClose() { this.readyState = 3; this.fire('close'); }
}

function makeHook() {
  const sockets: FakeSocket[] = [];
  const term = useTerminal({
    url: () => 'ws://t/ws',
    wsFactory: (u: string) => { const s = new FakeSocket(u); sockets.push(s); return s; },
    retryBaseMs: 50, maxRetryMs: 100,
  });
  return { term, sockets };
}

describe('useTerminal', () => {
  let hook: ReturnType<typeof makeHook>;
  beforeEach(() => { vi.useFakeTimers(); hook = makeHook(); });
  afterEach(() => { vi.useRealTimers(); hook.term.disconnect(); });

  it('connect 后握手 open → 自动发 list', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    expect(ws.sent.at(-1)!.type).toBe(C2S.LIST);
  });

  it('收 session-list 更新 store.sessions', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const fake = { id: 's1', name: 'A', state: 'running' as const, cwd: '', projectId: null, cols: 80, rows: 24, exitCode: null };
    ws.emitMessage({ type: S2C.SESSION_LIST, sessions: [fake] });
    expect(hook.term.state.sessions).toHaveLength(1);
    const restored = { ...fake, id: 's2', restored: true, kind: 'agent' as const, agentId: 'opencode' };
    ws.emitMessage({ type: S2C.SESSION_LIST, sessions: [restored] });
    expect(hook.term.state.sessions[0].restored).toBe(true);
    expect(hook.term.state.sessions[0].kind).toBe('agent');
  });

  it('createSession 发 create，事件驱动解析 session-created 并置为 active', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.createSession({ projectId: 'p1', cols: 90, rows: 30, kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
    expect(ws.sent.at(-1)!.type).toBe(C2S.CREATE);
    expect(ws.sent.at(-1)).toMatchObject({ kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
    const created = { id: 'sX', name: 'X', projectId: 'p1', state: 'running' as const, cwd: '', cols: 90, rows: 30, exitCode: null };
    ws.emitMessage({ type: S2C.SESSION_CREATED, session: created });
    await p;
    expect(hook.term.state.activeSessionId).toBe('sX');
  });

  it('replay 走 on 事件订阅者', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    hook.term.state.activeSessionId = 's1';
    const writes: string[] = [];
    hook.term.on(S2C.REPLAY, (m: any) => writes.push(m.data));
    ws.emitMessage({ type: S2C.REPLAY, sessionId: 's1', data: '\x1b[2J\x1b[Htail' });
    expect(writes[0]).toContain('tail');
  });

  it('断线重连: close 后退避重开并重新 start 当前会话', () => {
    hook.term.state.activeSessionId = 's1';
    hook.term.connect();
    const ws0 = hook.sockets[0];
    ws0.emitOpen();
    ws0.emitClose();
    expect(hook.term.state.status).toBe('reconnecting');
    vi.advanceTimersByTime(60);
    expect(hook.sockets.length).toBe(2);
    const ws1 = hook.sockets[1];
    ws1.emitOpen();
    expect(ws1.sent.some((m) => m.type === C2S.START && m.sessionId === 's1')).toBe(true);
  });

  it('disconnect 主动关闭后不自动重连', () => {
    hook.term.connect();
    const ws0 = hook.sockets[0];
    ws0.emitOpen();
    hook.term.disconnect();
    expect(ws0.closed).toBe(true);
    ws0.emitClose();
    vi.advanceTimersByTime(500);
    expect(hook.sockets.length).toBe(1);
  });

  it('restoreSession 发 restore，收 session-created 解析并带 resumed', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.restoreSession('s_old');
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.RESTORE, sessionId: 's_old' });
    ws.emitMessage({ type: S2C.SESSION_CREATED, session: { id: 's_old', name: 'A', projectId: null, state: 'running', cwd: '', cols: 80, rows: 24, exitCode: null, restored: true, kind: 'agent', resumed: false } });
    const s = await p;
    expect(s?.resumed).toBe(false);
    expect(hook.term.state.activeSessionId).toBe('s_old');
  });

  it('restoreSession 透传 name，recreated 标记透传', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.restoreSession('s_gone', { name: '旧会话' });
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.RESTORE, sessionId: 's_gone', name: '旧会话' });
    ws.emitMessage({ type: S2C.SESSION_CREATED, session: { id: 's_gone', name: '旧会话', projectId: null, state: 'running', cwd: '', cols: 80, rows: 24, exitCode: null, recreated: true } });
    const s = await p;
    expect(s?.recreated).toBe(true);
  });

  it('restoreSession 收 restore-failed 返回 null', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.restoreSession('ghost');
    ws.emitMessage({ type: S2C.ERROR, code: 'restore-failed', message: 'not-found' });
    expect(await p).toBe(null);
  });

  it('input/resize 转发到当前连接', () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    hook.term.state.activeSessionId = 's1';
    hook.term.input('ls\r');
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.INPUT, data: 'ls\r' });
    hook.term.input('other\r', 's2');
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.INPUT, data: 'other\r', sessionId: 's2' });
    hook.term.resize(120, 40);
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.RESIZE, cols: 120, rows: 40 });
  });
});
