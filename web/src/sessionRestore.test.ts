import { describe, it, expect } from 'vitest';
import { pickRestoredAgent, restoredAgentIds } from './sessionRestore';
import type { SessionSummary } from './useTerminal';

const s = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id, name: id, projectId: 'p1', state: 'running', cwd: '', cols: 80, rows: 24, exitCode: null, ...extra,
});

describe('sessionRestore', () => {
  it('pickRestoredAgent 只挑 restored 且 kind=agent 的第一条', () => {
    const list = [s('s1'), s('s2', { restored: true, kind: 'shell' }), s('s3', { restored: true, kind: 'agent', agentId: 'opencode' })];
    expect(pickRestoredAgent(list)?.id).toBe('s3');
    expect(pickRestoredAgent([s('s1')])).toBeNull();
  });

  it('restoredAgentIds 返回全部已恢复 agent 会话 id', () => {
    const list = [s('s1', { restored: true, kind: 'agent' }), s('s2'), s('s3', { restored: true, kind: 'agent' })];
    expect(restoredAgentIds(list)).toEqual(['s1', 's3']);
  });
});
