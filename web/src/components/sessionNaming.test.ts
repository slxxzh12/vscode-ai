import { describe, it, expect } from 'vitest';
import { createReadyGate } from './sessionNaming';

describe('createReadyGate', () => {
  it('最短时长内即使静默也不就绪', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    now = 2999;
    expect(g.poll()).toBe('waiting');
  });

  it('过了最短时长且静默达标即就绪', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    now = 3000;
    expect(g.poll()).toBe('ready');
  });

  it('输出会重置静默计时', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    now = 3000;
    g.output();
    expect(g.poll()).toBe('waiting');
    now = 4000;
    expect(g.poll()).toBe('waiting');
    now = 4200;
    expect(g.poll()).toBe('ready');
  });

  it('超时返回 timeout', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    for (let i = 0; i < 100; i += 1) { now += 500; g.output(); }
    expect(now).toBe(50000);
    expect(g.poll()).toBe('timeout');
  });

  it('可覆盖默认阈值', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now, minMs: 100, quietMs: 50, timeoutMs: 1000 });
    now = 100;
    expect(g.poll()).toBe('ready');
  });
});
