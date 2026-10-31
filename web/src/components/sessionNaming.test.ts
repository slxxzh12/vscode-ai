import { describe, it, expect } from 'vitest';
import { createReadyGate, paletteOffersRename, renameDialogOpen, waitForScreen } from './sessionNaming';

const PALETTE_LINE = '  ┃ /rename       Rename session                                          ┃';
const DIALOG_HEADER = '                                Rename Session                                       esc';
const HOME_PALETTE = '  ┃ /security-scan   Run AgentShield against agent, hook, MCP, permission  ┃';
const HOME_COMPOSER = '  ┃  /rename';

describe('paletteOffersRename：/rename 命令在当前会话可用吗', () => {
  it('命令面板出现「/rename … Rename session」→ 命中', () => {
    expect(paletteOffersRename(['x', PALETTE_LINE])).toBe(true);
  });
  it('新会话（还没开始对话）只有裸 /rename，面板没有该项 → 不命中', () => {
    expect(paletteOffersRename([HOME_PALETTE, HOME_COMPOSER])).toBe(false);
  });
  it('已打开改名框时不再算面板项', () => {
    expect(paletteOffersRename([DIALOG_HEADER])).toBe(false);
  });
});

describe('renameDialogOpen：改名框是否已弹出', () => {
  it('标题行「Rename Session … esc」→ 命中', () => {
    expect(renameDialogOpen(['x', DIALOG_HEADER, 'enter submit'])).toBe(true);
  });
  it('面板阶段（那行带 /rename 斜杠）不算改名框', () => {
    expect(renameDialogOpen([PALETTE_LINE])).toBe(false);
  });
  it('新会话只有裸 /rename → 不命中', () => {
    expect(renameDialogOpen([HOME_COMPOSER])).toBe(false);
  });
});

describe('waitForScreen：轮询屏幕直到条件成立', () => {
  it('条件成立即返回 true，且按 pollMs 推进', async () => {
    let now = 0;
    let n = 0;
    const sleep = async (ms: number) => { now += ms; };
    const ok = await waitForScreen(
      () => { n += 1; return n >= 3; },
      { readScreen: () => [], now: () => now, sleep, pollMs: 100, timeoutMs: 5000 },
    );
    expect(ok).toBe(true);
    expect(now).toBe(200);
  });
  it('超时返回 false', async () => {
    let now = 0;
    const sleep = async (ms: number) => { now += ms; };
    const ok = await waitForScreen(() => false, { readScreen: () => [], now: () => now, sleep, pollMs: 100, timeoutMs: 300 });
    expect(ok).toBe(false);
    expect(now).toBeGreaterThanOrEqual(300);
  });
  it('活动会话中途被切走 → 立即返回 false', async () => {
    let now = 0;
    let active = true;
    let calls = 0;
    const sleep = async (ms: number) => { now += ms; };
    const ok = await waitForScreen(
      () => { calls += 1; if (calls >= 3) active = false; return false; },
      { readScreen: () => [], isActive: () => active, now: () => now, sleep, pollMs: 100, timeoutMs: 5000 },
    );
    expect(ok).toBe(false);
    expect(now).toBeLessThan(1000);
  });
});

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
