import fs from 'node:fs';
import { buildResumeCommand } from './agent-resume.js';

// 账本 updatedAt 只在创建/退出/发现 agent 会话时更新；用户持续聊天时不变。
// 因此“最近使用过哪个会话”以会话日志 mtime 为准（10s 定时刷盘），再退回账本时间。
export function lastActiveAtOf(rec, ledger = null) {
  const logMtime = ledger && typeof ledger.logMtime === 'function' ? Number(ledger.logMtime(rec?.id)) || 0 : 0;
  const updatedAt = Number(rec?.updatedAt) || 0;
  const createdAt = Number(rec?.createdAt) || 0;
  return Math.max(logMtime, updatedAt, createdAt);
}

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
    lastActiveAt: lastActiveAtOf(rec, ledger),
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

// 启动时最多自动恢复的会话数（按最近活跃时间取最新）。其余标记为 exited，
// 需要时从历史里按需恢复，避免一次拉起几十个 Agent 把内存和 CPU 打满。
export const MAX_AUTO_RESTORE = 3;
// 超过这个时间没活跃过的会话不随启动自动恢复（久远历史只在历史面板里按需打开）。
export const MAX_AUTO_RESTORE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// 启动时按账本重建会话：逐条 restoreRecord，单条失败不阻断其它。
export async function restoreSessions({
  ledger, sessionManager, agents = [], logger = console, resumeDelayMs = 1500, exists = fs.existsSync,
  discover = null, maxRestore = MAX_AUTO_RESTORE, maxAgeMs = MAX_AUTO_RESTORE_AGE_MS,
  now = Date.now,
} = {}) {
  const raw = ledger.read().sessions || [];
  // 按“最近活跃时间”（日志 mtime 优先）排序，确保恢复的是最近用的 3 个，
  // 而不是账本里 updatedAt 恰好比较新的那些。
  const activity = new Map(raw.map((r) => [r.id, lastActiveAtOf(r, ledger)]));
  const records = [...raw].sort((a, b) => (activity.get(b.id) || 0) - (activity.get(a.id) || 0));
  const limit = Number.isFinite(maxRestore) ? Math.max(0, Math.floor(maxRestore)) : Infinity;
  const ageLimit = Number.isFinite(maxAgeMs) ? Math.max(0, maxAgeMs) : Infinity;
  const result = { restored: 0, skipped: [], deferred: [] };
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
    const last = activity.get(rec.id) || 0;
    if (ageLimit !== Infinity && last > 0 && now() - last > ageLimit) {
      // 久远历史不自动拉起；标记 exited，后续需要时由用户在历史面板按需恢复
      result.deferred.push(rec.id);
      ledger.upsert?.({ id: rec.id, state: 'exited' });
      continue;
    }
    if (result.restored >= limit) {
      // 超出本次自动恢复上限：标记为 exited，避免一直显示 running 并在下次启动再次排队
      result.deferred.push(rec.id);
      ledger.upsert?.({ id: rec.id, state: 'exited' });
      continue;
    }
    try {
      await restoreRecord({ ledger, sessionManager, agents, logger, rec, resumeDelayMs, exists, isAgentSessionIdTaken, discover });
      result.restored += 1;
    } catch (e) {
      const reason = (e && e.message) || 'restore-failed';
      result.skipped.push({ id: rec.id, reason });
      logger?.warn?.('session restore failed', rec.id, reason);
    }
  }
  if (result.deferred.length) logger?.info?.(`session restore deferred: ${result.deferred.length} (max ${limit})`);
  return result;
}
