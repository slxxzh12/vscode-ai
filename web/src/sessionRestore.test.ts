import { describe, it, expect, vi } from 'vitest';
import { openRestoredSession, pickRestoredAgent, restoredAgentIds } from './sessionRestore';
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

  it('恢复成功后始终显式激活中心页签（activeSessionId 未变时也能切回终端）', async () => {
    const activate = vi.fn();
    const session = s('s1', { restored: true, kind: 'shell' });
    const out = await openRestoredSession('s1', {
      restore: async () => session,
      activate,
      error: () => '',
      onFailed: vi.fn(),
      onFreshAgent: vi.fn(),
      onRecreated: vi.fn(),
    });
    expect(out).toBe(session);
    expect(activate).toHaveBeenCalledWith('s1');
  });

  it('恢复失败时不激活页签，回调原因', async () => {
    const activate = vi.fn();
    const onFailed = vi.fn();
    const out = await openRestoredSession('ghost', {
      restore: async () => null,
      activate,
      error: () => 'restore-failed: not-found',
      onFailed,
      onFreshAgent: vi.fn(),
      onRecreated: vi.fn(),
    });
    expect(out).toBeNull();
    expect(activate).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith('restore-failed: not-found');
  });

  it('agent 未续上下文时激活并提示', async () => {
    const activate = vi.fn();
    const onFreshAgent = vi.fn();
    await openRestoredSession('s1', {
      restore: async () => s('s1', { restored: true, kind: 'agent', resumed: false }),
      activate,
      error: () => '',
      onFailed: vi.fn(),
      onFreshAgent,
      onRecreated: vi.fn(),
    });
    expect(activate).toHaveBeenCalledWith('s1');
    expect(onFreshAgent).toHaveBeenCalledTimes(1);
  });

  it('账本缺失重建（recreated）时激活并提示', async () => {
    const activate = vi.fn();
    const onRecreated = vi.fn();
    await openRestoredSession('s1', {
      restore: async () => s('s1', { recreated: true }),
      activate,
      error: () => '',
      onFailed: vi.fn(),
      onFreshAgent: vi.fn(),
      onRecreated,
    });
    expect(activate).toHaveBeenCalledWith('s1');
    expect(onRecreated).toHaveBeenCalledTimes(1);
  });
});
