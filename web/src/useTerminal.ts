import { reactive } from 'vue';
import { C2S, S2C } from '@devflow/shared';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; createdAt?: number; kind?: 'agent' | 'shell' | 'workflow'; agentId?: string | null; restored?: boolean; resumed?: boolean; recreated?: boolean; }
export type Handler = (msg: any) => void;

export interface UseTerminalOptions {
  url?: () => string;
  wsFactory?: (url: string) => any;
  retryBaseMs?: number;
  maxRetryMs?: number;
  onStatusChange?: (s: ConnStatus) => void;
}

export function useTerminal(opts: UseTerminalOptions = {}) {
  const WS_CONNECTING = 0;
  const WS_OPEN = 1;
  const url = opts.url || (() => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const wsFactory = opts.wsFactory || ((u: string) => new WebSocket(u));
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const maxRetryMs = opts.maxRetryMs ?? 10000;

  const state = reactive({
    status: 'idle' as ConnStatus,
    sessions: [] as SessionSummary[],
    activeSessionId: null as string | null,
    error: '' as string,
  });

  let ws: any = null;
  let manualClose = false;
  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Map<string, Set<Handler>>();
  let listResolve: ((s: SessionSummary[]) => void) | null = null;
  let createdResolve: ((s: SessionSummary) => void) | null = null;
  let createdReject: ((e: Error) => void) | null = null;
  let restoreResolve: ((s: SessionSummary | null) => void) | null = null;
  let onOutputCb: ((data: string) => void) | null = null;
  let onReplayCb: ((data: string) => void) | null = null;

  function setStatus(s: ConnStatus) { state.status = s; opts.onStatusChange?.(s); }
  function emit(type: string, msg: any) { handlers.get(type)?.forEach((h) => h(msg)); }
  const outbox: any[] = [];
  function send(type: string, payload: Record<string, unknown> = {}) {
    const m = { type, ...payload };
    if (ws && ws.readyState === WS_OPEN) ws.send(JSON.stringify(m));
    else outbox.push(m);                 // 未连上先排队，open 后 flush
  }
  function flushOutbox() { while (outbox.length) { const m = outbox.shift(); if (ws && ws.readyState === WS_OPEN) ws.send(JSON.stringify(m)); } }

  function onOpen() {
    retry = 0;
    setStatus('open');
    flushOutbox();
    send(C2S.LIST);
    if (state.activeSessionId) send(C2S.START, { sessionId: state.activeSessionId });
  }
  function onClose() {
    setStatus(manualClose ? 'closed' : 'reconnecting');
    if (manualClose) return;
    const delay = Math.min(retryBaseMs * 2 ** retry, maxRetryMs);
    retry += 1;
    retryTimer = setTimeout(() => { connect(); }, delay);
  }
  function onMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case S2C.SESSION_LIST:
        state.sessions = msg.sessions || [];
        listResolve?.(state.sessions); listResolve = null;
        emit(S2C.SESSION_LIST, msg); break;
      case S2C.SESSION_CREATED: {
        state.sessions = state.sessions.filter((s) => s.id !== msg.session.id).concat([msg.session]);
        state.activeSessionId = msg.session.id;
        createdResolve?.(msg.session); createdResolve = null; createdReject = null;
        restoreResolve?.(msg.session); restoreResolve = null;
        emit(S2C.SESSION_CREATED, msg); break;
      }
      case S2C.SESSION_EXITED: {
        const s = state.sessions.find((x) => x.id === msg.sessionId);
        if (s) s.state = 'exited';
        break;
      }
      case S2C.OUTPUT: if (msg.sessionId === state.activeSessionId) { onOutputCb?.(msg.data); emit(S2C.OUTPUT, msg); } break;
      case S2C.REPLAY: if (msg.sessionId === state.activeSessionId) { onReplayCb?.(msg.data); emit(S2C.REPLAY, msg); } break;
      case S2C.ERROR:
        state.error = `${msg.code}: ${msg.message}`;
        if (msg.code === 'restore-failed') { restoreResolve?.(null); restoreResolve = null; }
        // create 失败必须让 await createSession 落地（否则调用方永久挂起、界面无任何反馈）
        if (createdReject) {
          const reject = createdReject;
          createdReject = null; createdResolve = null;
          const err = new Error(String(msg.message || msg.code || 'create-failed'));
          (err as Error & { code?: string }).code = msg.code || 'create-failed';
          reject(err);
        }
        emit(S2C.ERROR, msg); break;
      default: emit(msg.type, msg); break;
    }
  }

  function connect() {
    if (ws && (ws.readyState === WS_CONNECTING || ws.readyState === WS_OPEN)) return;
    manualClose = false;
    setStatus('connecting');
    ws = wsFactory(url());
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', (e: any) => onMessage(e.data));
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', () => { /* close 会触发重连 */ });
  }

  return {
    state,
    connect,
    disconnect() { manualClose = true; outbox.length = 0; if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } if (ws) { try { ws.close(); } catch { /* noop */ } } },
    send,
    on(type: string, h: Handler): () => void {
      let s = handlers.get(type);
      if (!s) { s = new Set(); handlers.set(type, s); }
      s.add(h);
      return () => { s!.delete(h); };
    },
    setOutput(activeSessionId: string | null) { state.activeSessionId = activeSessionId; },
    input(data: string, sessionId: string | null = null) { send(C2S.INPUT, { data, sessionId }); },
    resize(cols: number, rows: number) { send(C2S.RESIZE, { cols, rows }); },
    stop() { send(C2S.STOP); state.activeSessionId = null; },
    killSession(id: string) {
      send(C2S.KILL, { sessionId: id });
      state.sessions = state.sessions.filter((s) => s.id !== id);
      if (state.activeSessionId === id) state.activeSessionId = null;
    },
    switchTo(id: string) { state.activeSessionId = id; send(C2S.START, { sessionId: id }); },
    restoreSession(id: string, opts: { name?: string } = {}) {
      send(C2S.RESTORE, { sessionId: id, name: opts.name });
      return new Promise<SessionSummary | null>((resolve) => { restoreResolve = resolve; });
    },
    createSession(input: { projectId?: string | null; cols?: number; rows?: number; kind?: 'agent' | 'shell'; agentId?: string | null; agentCmd?: string | null }) {
      send(C2S.CREATE, { ...input });
      return new Promise<SessionSummary>((resolve, reject) => { createdResolve = resolve; createdReject = reject; });
    },
    listSessions() {
      send(C2S.LIST);
      return new Promise<SessionSummary[]>((resolve) => { listResolve = resolve; });
    },
    bindIO(cb: { output: (d: string) => void; replay: (d: string) => void }) { onOutputCb = cb.output; onReplayCb = cb.replay; },
  };
}
