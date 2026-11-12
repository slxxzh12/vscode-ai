import { describe, it, expect } from 'vitest';
import { needsSelectedAgentSession, canReuseAgentSession, isRetiredAgent, needsAgentStart, resolveAgentSelection } from './agentTarget';

describe('isRetiredAgent', () => {
  it('pi 视为已下线，其它保留', () => {
    expect(isRetiredAgent('pi')).toBe(true);
    expect(isRetiredAgent('PI')).toBe(true);
    expect(isRetiredAgent('opencode')).toBe(false);
    expect(isRetiredAgent('')).toBe(false);
  });
});

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

  it('同 Agent 但会话已退出时需要重建，避免把消息写进死进程', () => {
    const dead = { id: 's1', kind: 'agent' as const, agentId: 'opencode', state: 'exited' as const };
    expect(needsSelectedAgentSession(dead, 'opencode')).toBe(true);
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

  it('已退出的会话不可复用（否则发消息会落进死进程）', () => {
    const dead = { id: 's1', kind: 'agent' as const, agentId: 'opencode', projectId: 'p1', state: 'exited' as const };
    expect(canReuseAgentSession(dead, 'opencode', 'p1')).toBe(false);
  });

  it('显式新建 Agent 时即使有同 Agent 同项目的运行中会话也不复用', () => {
    const live = { id: 's1', kind: 'agent' as const, agentId: 'opencode', projectId: 'p1', state: 'running' as const };
    expect(canReuseAgentSession(live, 'opencode', 'p1', true)).toBe(false);
  });
});

describe('needsAgentStart', () => {
  it('无活动会话时需要启动', () => {
    expect(needsAgentStart(null, null, 'opencode')).toBe(true);
  });

  it('当前活动是已退出的 Agent（哪怕不是固定会话）需要新建', () => {
    expect(needsAgentStart({ id: 'dead', kind: 'agent', agentId: 'opencode', state: 'exited' }, 'fixed', 'opencode')).toBe(true);
  });

  it('当前活动是运行中的其他 Agent 时不抢，直接发给它', () => {
    expect(needsAgentStart({ id: 'other', kind: 'agent', agentId: 'nga', state: 'running' }, 'fixed', 'opencode')).toBe(false);
  });

  it('当前活动是运行中的 shell 时直接发给它', () => {
    expect(needsAgentStart({ id: 'sh', kind: 'shell', state: 'running' }, 'fixed', 'opencode')).toBe(false);
  });

  it('固定 Agent 运行中且 Agent 一致时不需要重建', () => {
    expect(needsAgentStart({ id: 'fixed', kind: 'agent', agentId: 'opencode', state: 'running' }, 'fixed', 'opencode')).toBe(false);
  });

  it('固定 Agent 运行中但切换了所选 Agent 时需要重建', () => {
    expect(needsAgentStart({ id: 'fixed', kind: 'agent', agentId: 'opencode', state: 'running' }, 'fixed', 'nga')).toBe(true);
  });
});

describe('resolveAgentSelection', () => {
  it('配置热更新时保留用户当前选择，不被旧的默认值覆盖', () => {
    expect(resolveAgentSelection('nga', ['opencode', 'nga'], 'opencode', true)).toBe('nga');
  });

  it('保留模式下当前选择已不存在时回退到服务端默认', () => {
    expect(resolveAgentSelection('gone', ['opencode', 'nga'], 'nga', true)).toBe('nga');
  });

  it('非保留模式（首次挂载）使用服务端默认', () => {
    expect(resolveAgentSelection('nga', ['opencode', 'nga'], 'opencode', false)).toBe('opencode');
  });

  it('默认值无效时回退到列表第一个', () => {
    expect(resolveAgentSelection('x', ['opencode', 'nga'], 'missing', true)).toBe('opencode');
  });

  it('空列表时保持当前值', () => {
    expect(resolveAgentSelection('nga', [], 'opencode', true)).toBe('nga');
  });
});
