import { describe, it, expect } from 'vitest';
import { restartHintKey, canRestart } from './portRestart';

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
