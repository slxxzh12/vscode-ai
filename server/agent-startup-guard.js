// Agent 会话启动弹框兜底：启动命令提交后，在固定时间窗内盲发 ESC，
// 顶掉 opencode 的升级框/告警框（不做内容识别，避免受版本/i18n 影响）。
export function createAgentStartupGuard({
  sessionManager,
  delaysMs = [3000, 4500],
  esc = '\x1b',
  schedule = setTimeout,
  clear = clearTimeout,
  logger = console,
} = {}) {
  const timers = new Map();   // sessionId -> handle[]

  function disarm(id) {
    const handles = timers.get(id);
    if (!handles) return;
    for (const h of handles) { try { clear(h); } catch { /* ignore */ } }
    timers.delete(id);
  }

  function arm(session) {
    if (!session || session.kind !== 'agent' || !session.id) return;
    disarm(session.id);
    const handles = delaysMs.map((delay) => schedule(() => {
      const cur = sessionManager.get(session.id);
      if (!cur || !cur.alive || cur.kind !== 'agent') return;
      try { sessionManager.write(session.id, esc); }
      catch (e) { logger?.warn?.('agent startup esc failed', e && e.message); }
    }, delay));
    timers.set(session.id, handles);
  }

  return { arm, disarm };
}
