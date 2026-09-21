import fs from 'node:fs';
import { buildResumeCommand } from './agent-resume.js';

// 单条账本记录 → 重建会话：复用 id/createdAt、预填回滚、agent 注入续会话命令。
// 返回 { session, resumed }；resumed 仅在成功注入续会话命令时为 true。
export async function restoreRecord({
  ledger, sessionManager, agents = [], logger = console,
  rec, resumeDelayMs = 1500, exists = fs.existsSync,
  isAgentSessionIdTaken = () => false, discover = null,
} = {}) {
  if (!rec || !rec.id) throw new Error('bad-record');
  if (rec.kind === 'workflow') throw new Error('workflow-skip');
  if (rec.cwd && !exists(rec.cwd)) throw new Error('cwd-missing');
  const replay = ledger.readLog(rec.id);
  const session = await sessionManager.create({
    id: rec.id, name: rec.name, projectId: rec.projectId, cwd: rec.cwd,
    kind: rec.kind, agentId: rec.agentId, agentCmd: rec.agentCmd,
    cols: rec.cols, rows: rec.rows, createdAt: rec.createdAt,
    replay: replay || null,
  });
  sessionManager.markRestored(session.id);
  const agent = rec.kind === 'agent' ? (agents.find((a) => a.id === rec.agentId) || null) : null;
  // 账本没记下 agentSessionId（发现失败/未及时发现）时现场补一次发现，尽量续回原对话而非重开
  let agentSessionId = typeof rec.agentSessionId === 'string' ? rec.agentSessionId : '';
  if (rec.kind === 'agent' && !agentSessionId && typeof discover === 'function') {
    try { agentSessionId = (await discover(rec)) || ''; } catch { agentSessionId = ''; }
    if (agentSessionId) ledger.upsert?.({ ...rec, agentSessionId, updatedAt: Date.now() });
  }
  let resumeCmd = rec.kind === 'agent' ? buildResumeCommand({ agent, agentSessionId }) : null;
  // 目标对话已被别的活跃会话占用：不抢，退化为原命令重开
  if (resumeCmd && agentSessionId && isAgentSessionIdTaken(agentSessionId, rec.id)) resumeCmd = null;
  const cmd = resumeCmd || (agent && agent.cmd) || rec.agentCmd || null;
  session.resumed = !!resumeCmd;
  if (cmd) {
    setTimeout(() => { sessionManager.write(session.id, `${cmd}\r`); }, resumeDelayMs);
    logger?.info?.(`session restored with command: ${session.id}`);
  } else {
    logger?.info?.(`session restored: ${session.id}`);
  }
  return { session, resumed: !!resumeCmd };
}

// 启动时按账本重建会话：逐条 restoreRecord，单条失败不阻断其它。
export async function restoreSessions({
  ledger, sessionManager, agents = [], logger = console, resumeDelayMs = 1500, exists = fs.existsSync,
  discover = null,
} = {}) {
  const records = ledger.read().sessions || [];
  const result = { restored: 0, skipped: [] };
  const isAgentSessionIdTaken = (agentSessionId, exceptDevflowId) => {
    for (const row of records) {
      if (row.id === exceptDevflowId || !row.agentSessionId || row.agentSessionId !== agentSessionId) continue;
      const live = sessionManager.get(row.id);
      if (live && live.state === 'running') return true;
    }
    return false;
  };
  for (const rec of records) {
    if (!rec || !rec.id || rec.kind === 'workflow') continue;
    if (rec.state === 'exited') continue;   // 关闭的会话只留在账本供按需恢复，不随启动自动拉起
    if (rec.cwd && !exists(rec.cwd)) { result.skipped.push({ id: rec.id, reason: 'cwd-missing' }); continue; }
    try {
      await restoreRecord({ ledger, sessionManager, agents, logger, rec, resumeDelayMs, exists, isAgentSessionIdTaken, discover });
      result.restored += 1;
    } catch (e) {
      const reason = (e && e.message) || 'restore-failed';
      result.skipped.push({ id: rec.id, reason });
      logger?.warn?.('session restore failed', rec.id, reason);
    }
  }
  return result;
}
