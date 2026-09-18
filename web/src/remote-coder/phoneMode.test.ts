import { describe, it, expect } from 'vitest';
import { isAgentSession, phoneHintKey } from './phoneMode';

describe('isAgentSession', () => {
  it('kind=agent 或带 agentId 视为 Agent 会话', () => {
    expect(isAgentSession({ id: 's1', kind: 'agent' })).toBe(true);
    expect(isAgentSession({ id: 's2', kind: 'shell', agentId: 'opencode' })).toBe(true);
    expect(isAgentSession({ id: 's3', kind: 'shell', agentId: null })).toBe(false);
    expect(isAgentSession({ id: 's4' })).toBe(false);
    expect(isAgentSession(null)).toBe(false);
    expect(isAgentSession(undefined)).toBe(false);
  });
});

describe('phoneHintKey', () => {
  it('已选会话 → 无提示', () => {
    expect(phoneHintKey({ sessions: [{ id: 's1', state: 'running' }], activeSessionId: 's1' })).toBeNull();
  });

  it('有运行中会话但未选 → 提示点页签', () => {
    expect(phoneHintKey({ sessions: [{ id: 's1', state: 'running' }], activeSessionId: null })).toBe('remote.pick_session');
  });

  it('无运行中会话 → 提示去桌面开', () => {
    expect(phoneHintKey({ sessions: [{ id: 's1', state: 'exited' }], activeSessionId: null })).toBe('remote.no_sessions');
    expect(phoneHintKey({ sessions: [], activeSessionId: null })).toBe('remote.no_sessions');
  });
});
