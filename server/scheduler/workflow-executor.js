import fs from 'node:fs';
import path from 'node:path';
import { t } from '../i18n.js';

function timeLabel(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function appendLog(logPath, line) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch { /* 日志失败不阻断 */ }
}

// 定时任务里 workflow 类型任务的执行器：新建 agent 会话 → 在会话里跑整条工作流
export function createWorkflowExecutor({ sessionManager, workflowRunner, resolveAgent, logger = console }) {
  function start({ task, runId, logFile, runContextPath = null, onStatus = () => {} }) {
    const notify = (s) => queueMicrotask(() => { try { onStatus(s); } catch (e) { logger?.warn?.('wf onStatus failed', e); } });
    const agent = resolveAgent ? resolveAgent(task.workflow?.agentId) : null;
    if (!agent) { notify({ status: 'failed', error: 'agent-not-found' }); return { error: 'agent-not-found' }; }
    let sessionId = null;
    let wfRunId = null;
    let off = null;
    const finished = () => { if (off) { off(); off = null; } };
    const handle = {
      get runId() { return wfRunId; },
      get sessionId() { return sessionId; },
      abort() { if (wfRunId) { try { workflowRunner.get(wfRunId)?.abort(); } catch { /* ignore */ } } },
    };
    sessionManager.create({
      projectId: task.projectId || null,
      cwd: task.cwd || null,
      kind: 'agent',
      agentId: agent.id,
      agentCmd: agent.cmd,
      name: t('sched.wf.session_name', { name: task.name, time: timeLabel() }),
      env: runContextPath ? { DEVFLOW_RUN_CONTEXT: runContextPath } : null,
    }).then((session) => {
      sessionId = session.id;
      appendLog(logFile, `# workflow ${task.workflow.workflowId} · agent ${agent.name} (${agent.cmd})`);
      appendLog(logFile, `# session ${session.id}`);
      const res = workflowRunner.startAll({ workflowId: task.workflow.workflowId, sessionId: session.id });
      if (!res.ok) {
        appendLog(logFile, '# workflow-not-found');
        notify({ status: 'failed', sessionId, error: 'workflow-not-found' });
        return;
      }
      wfRunId = res.run.runId;
      appendLog(logFile, `# steps ${res.run.snapshot().steps.length}`);
      off = workflowRunner.onStatus((run) => {
        if (run.runId !== wfRunId) return;
        const snap = run.snapshot();
        appendLog(logFile, `[${new Date().toISOString()}] ${snap.status} ${Math.min(snap.currentIndex + 1, snap.steps.length)}/${snap.steps.length}`);
        if (snap.status === 'done') { finished(); notify({ status: 'success', sessionId }); }
        else if (snap.status === 'failed') { finished(); notify({ status: 'failed', sessionId, error: snap.errorMessage || 'workflow failed' }); }
        else if (snap.status === 'aborted') { finished(); notify({ status: 'aborted', sessionId }); }
        else if (snap.status === 'paused') { notify({ status: 'paused', sessionId }); }
      });
      notify({ status: 'running', sessionId });
    }).catch((e) => {
      logger?.warn?.('workflow executor session create failed', (e && e.message) || e);
      appendLog(logFile, `# session-create-failed ${String(e && e.message || e)}`);
      notify({ status: 'failed', error: 'session-create-failed' });
    });
    return handle;
  }
  return { start };
}
