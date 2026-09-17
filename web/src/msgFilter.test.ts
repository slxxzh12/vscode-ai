import { describe, it, expect } from 'vitest';
import { sessionOfActiveTab, resolveProject, filterMessages } from './msgFilter';
import type { HistoryMessage } from './useMessageHistory';
import type { CenterTab } from './useCenter';

const msg = (over: Partial<HistoryMessage> = {}): HistoryMessage => ({ text: 'x', ts: 1, ...over });
const sessionTab = (id: string, label: string): CenterTab => ({ id: `s:${id}`, kind: 'session', label });

describe('sessionOfActiveTab', () => {
  it('会话页签返回 sessionId + 显示名，其它返回 null', () => {
    expect(sessionOfActiveTab(sessionTab('s_1', 'agent'))).toEqual({ sessionId: 's_1', tabName: 'agent' });
    expect(sessionOfActiveTab({ id: 'f:p|a.ts', kind: 'file', label: 'a.ts' })).toBeNull();
    expect(sessionOfActiveTab(null)).toBeNull();
  });
});

describe('resolveProject', () => {
  it('活跃会话优先，其次查映射，都查不到为 null', () => {
    expect(resolveProject(msg({ sessionId: 's_1' }), { s_1: 'live' }, { s_1: 'saved' })).toBe('live');
    expect(resolveProject(msg({ sessionId: 's_1' }), {}, { s_1: 'saved' })).toBe('saved');
    expect(resolveProject(msg({ sessionId: 's_1' }), { s_1: null }, {})).toBeNull();
    expect(resolveProject(msg({ sessionId: 's_1' }), {}, {})).toBeNull();
    expect(resolveProject(msg(), {}, {})).toBeNull();
  });
});

describe('filterMessages', () => {
  const base = { sessionId: null, tabName: null, projectId: null, liveProjectBySession: {}, map: {} };

  it('筛选开启：按 sessionId 匹配；无 sessionId 的老消息退回 tabName', () => {
    const messages = [
      msg({ text: 'cur', sessionId: 's_1', tabName: 'agent' }),
      msg({ text: 'other', sessionId: 's_2', tabName: 'agent' }),
      msg({ text: 'legacy-same-tab', tabName: 'agent' }),
      msg({ text: 'legacy-other-tab', tabName: 'shell' }),
      msg({ text: 'legacy-no-tab' }),
    ];
    const out = filterMessages({ ...base, messages, filterOn: true, sessionId: 's_1', tabName: 'agent' });
    expect(out.map((m) => m.text)).toEqual(['cur', 'legacy-same-tab']);
  });

  it('无当前会话时退化为项目过滤', () => {
    const messages = [
      msg({ text: 'p1', sessionId: 's_1' }),
      msg({ text: 'p2', sessionId: 's_2' }),
      msg({ text: 'unknown' }),
    ];
    const out = filterMessages({
      ...base, messages, filterOn: true, sessionId: null, tabName: null, projectId: 'p1',
      liveProjectBySession: { s_1: 'p1' }, map: { s_2: 'p2' },
    });
    expect(out.map((m) => m.text)).toEqual(['p1', 'unknown']);
  });

  it('关闭筛选：按项目过滤，无法归属的老消息照常显示', () => {
    const messages = [
      msg({ text: 'p1', sessionId: 's_1' }),
      msg({ text: 'p2', sessionId: 's_2' }),
      msg({ text: 'unknown', sessionId: 's_dead' }),
      msg({ text: 'no-sid' }),
    ];
    const out = filterMessages({
      ...base, messages, filterOn: false, projectId: 'p1',
      liveProjectBySession: {}, map: { s_1: 'p1', s_2: 'p2' },
    });
    expect(out.map((m) => m.text)).toEqual(['p1', 'unknown', 'no-sid']);
  });

  it('没有选中项目时全量返回', () => {
    const messages = [msg({ sessionId: 's_1' }), msg({ sessionId: 's_2' })];
    expect(filterMessages({ ...base, messages, filterOn: false, projectId: null }).map((m) => m.text)).toEqual(['x', 'x']);
  });
});
