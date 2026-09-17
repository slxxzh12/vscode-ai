import fs from 'node:fs';
import { buildResumeCommand } from './agent-resume.js';

// 启动时按账本重建会话：复用 id/createdAt、预填回滚、agent 注入续会话命令。
export async function restoreSessions({
  ledger, sessionManager, agents = [], logger = console, resumeDelayMs = 1500, exists = fs.existsSync,
} = {}) {
  const records = ledger.read().sessions || [];
  const result = { restored: 0, skipped: [] };
  for (const rec of records) {
    if (!rec || !rec.id || rec.kind === 'workflow') continue;
    if (rec.cwd && !exists(rec.cwd)) { result.skipped.push({ id: rec.id, reason: 'cwd-missing' }); continue; }
    try {
      const replay = ledger.readLog(rec.id);
      const session = await sessionManager.create({
        id: rec.id, name: rec.name, projectId: rec.projectId, cwd: rec.cwd,
        kind: rec.kind, agentId: rec.agentId, agentCmd: rec.agentCmd,
        cols: rec.cols, rows: rec.rows, createdAt: rec.createdAt,
        replay: replay || null,
      });
      sessionManager.markRestored(session.id);
      let cmd = null;
      if (rec.kind === 'agent') {
        const agent = agents.find((a) => a.id === rec.agentId) || null;
        // 能续则续；续不上退化为原 agent 命令（不续上下文，但 agent 仍自动起来）
        cmd = buildResumeCommand({ agent, agentSessionId: rec.agentSessionId })
          || (agent && agent.cmd) || rec.agentCmd || null;
      }
      if (cmd) {
        setTimeout(() => { sessionManager.write(session.id, `${cmd}\r`); }, resumeDelayMs);
        logger?.info?.(`session restored with command: ${session.id}`);
      } else {
        logger?.info?.(`session restored: ${session.id}`);
      }
      result.restored += 1;
    } catch (e) {
      const reason = (e && e.message) || 'restore-failed';
      result.skipped.push({ id: rec.id, reason });
      logger?.warn?.('session restore failed', rec.id, reason);
    }
  }
  return result;
}
