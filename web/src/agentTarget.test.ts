import { describe, it, expect } from 'vitest';
import { needsSelectedAgentSession, canReuseAgentSession } from './agentTarget';

describe('needsSelectedAgentSession', () => {
  it('没有活动会话时需要为所选 Agent 建会话', () => {
    expect(needsSelectedAgentSession(null, 'codeagent')).toBe(true);
  });

  it('活动会话是同一个 Agent 时不需要重建', () => {
    expect(needsSelectedAgentSession({ id: 's1', kind: 'agent', agentId: 'codeagent' }, 'codeagent')).toBe(false);
  });

  it('活动会话是别的 Agent 时需要切到所选 Agent', () => {
    expect(needsSelectedAgentSession({ id: 's1', kind: 'agent', agentId: 'nga' }, 'codeagent')).toBe(true);
    expect(needsSelectedAgentSession({ id: 's1', kind: 'agent', agentId: 'opencode' }, 'pi')).toBe(true);
  });

  it('shell / workflow 会话保持原目标，不被所选 Agent 抢走', () => {
    expect(needsSelectedAgentSession({ id: 's1', kind: 'shell' }, 'codeagent')).toBe(false);
    expect(needsSelectedAgentSession({ id: 's1', kind: 'workflow' }, 'codeagent')).toBe(false);
  });
});

describe('canReuseAgentSession', () => {
  it('同 Agent 同项目才可复用', () => {
    const s = { id: 's1', kind: 'agent' as const, agentId: 'codeagent', projectId: 'p1' };
    expect(canReuseAgentSession(s, 'codeagent', 'p1')).toBe(true);
    expect(canReuseAgentSession(s, 'codeagent', 'p2')).toBe(false);
    expect(canReuseAgentSession(s, 'pi', 'p1')).toBe(false);
  });

  it('无会话不可复用；无项目时按空项目匹配', () => {
    expect(canReuseAgentSession(null, 'codeagent', null)).toBe(false);
    expect(canReuseAgentSession({ id: 's1', kind: 'agent', agentId: 'codeagent' }, 'codeagent', null)).toBe(true);
    expect(canReuseAgentSession({ id: 's1', kind: 'agent', agentId: 'codeagent', projectId: 'p1' }, 'codeagent', null)).toBe(false);
  });
});
