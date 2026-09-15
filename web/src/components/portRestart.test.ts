import { describe, it, expect } from 'vitest';
import { restartHintKey, canRestart, planConfirm } from './portRestart';

describe('planConfirm（点「确定」时：保存并立即生效）', () => {
  const ok = { restartable: true, portSource: 'file' };
  it('端口没变：只关闭，不重启', () => {
    expect(planConfirm({ port: 22222, loadedPort: 22222, state: ok })).toEqual({ action: 'close' });
  });
  it('端口变了且可重启：保存后重启', () => {
    expect(planConfirm({ port: 12345, loadedPort: 22222, state: ok })).toEqual({ action: 'restart', port: 12345 });
  });
  it('非法端口：拦住并提示', () => {
    expect(planConfirm({ port: 0, loadedPort: 22222, state: ok })).toEqual({ action: 'blocked', hintKey: 'term.port_invalid' });
    expect(planConfirm({ port: NaN, loadedPort: 22222, state: ok })).toEqual({ action: 'blocked', hintKey: 'term.port_invalid' });
    expect(planConfirm({ port: 70000, loadedPort: 22222, state: ok })).toEqual({ action: 'blocked', hintKey: 'term.port_invalid' });
  });
  it('端口变了但 dev 钉住：拦住并说明', () => {
    expect(planConfirm({ port: 12345, loadedPort: 22222, state: { restartable: false, portSource: 'env' } }))
      .toEqual({ action: 'blocked', hintKey: 'term.port_restart_pinned' });
  });
  it('端口变了但非绿色包：拦住并说明', () => {
    expect(planConfirm({ port: 12345, loadedPort: 22222, state: { restartable: false, portSource: 'default' } }))
      .toEqual({ action: 'blocked', hintKey: 'term.port_restart_notpackaged' });
  });
  it('首次加载未取到端口（loadedPort 为 null）：不误判为变更', () => {
    expect(planConfirm({ port: null as any, loadedPort: null as any, state: ok })).toEqual({ action: 'close' });
  });
});

describe('portRestart', () => {
  it('env 钉住时给出 pinned 提示且不可重启', () => {
    expect(canRestart({ restartable: false, portSource: 'env' })).toBe(false);
    expect(restartHintKey({ restartable: false, portSource: 'env' })).toBe('term.port_restart_pinned');
  });
  it('非绿色包时给出 notpackaged 提示', () => {
    expect(restartHintKey({ restartable: false, portSource: 'default' })).toBe('term.port_restart_notpackaged');
  });
  it('绿色包可重启', () => {
    expect(canRestart({ restartable: true, portSource: 'file' })).toBe(true);
    expect(restartHintKey({ restartable: true, portSource: 'file' })).toBe('');
  });
});
