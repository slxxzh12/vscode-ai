import { describe, it, expect } from 'vitest';
import { sessionOfActiveTab, resolveProject, filterMessages, filterSessionsByProject } from './msgFilter';
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

  it('选中目录后只保留该目录消息，无法归属的消息也隐藏', () => {
    const messages = [
      msg({ text: 'p1', sessionId: 's_1' }),
      msg({ text: 'p2', sessionId: 's_2' }),
      msg({ text: 'unknown', sessionId: 's_dead' }),
      msg({ text: 'no-sid' }),
    ];
    const out = filterMessages({
      ...base, messages, filterOn: true, sessionId: null, tabName: null, projectId: 'p1',
      liveProjectBySession: { s_1: 'p1' }, map: { s_2: 'p2' },
    });
    expect(out.map((m) => m.text)).toEqual(['p1']);
  });

  it('全部会话：只在当前目录内展示全部会话，不再跨项目', () => {
    const messages = [
      msg({ text: 'p1', sessionId: 's_1' }),
      msg({ text: 'p1b', sessionId: 's_3' }),
      msg({ text: 'p2', sessionId: 's_2' }),
      msg({ text: 'unknown', sessionId: 's_dead' }),
      msg({ text: 'no-sid' }),
    ];
    const out = filterMessages({
      ...base, messages, filterOn: false, projectId: 'p1',
      liveProjectBySession: {}, map: { s_1: 'p1', s_2: 'p2', s_3: 'p1' },
    });
    expect(out.map((m) => m.text)).toEqual(['p1', 'p1b']);
  });

  it('活跃会话属于其它目录时退回当前目录全部消息', () => {
    const messages = [
      msg({ text: 'p1', sessionId: 's_1' }),
      msg({ text: 'p2', sessionId: 's_2' }),
    ];
    const out = filterMessages({
      ...base, messages, filterOn: true, sessionId: 's_2', tabName: 'agent', projectId: 'p1',
      liveProjectBySession: { s_2: 'p2' }, map: { s_1: 'p1' },
    });
    expect(out.map((m) => m.text)).toEqual(['p1']);
  });

  it('未选目录时保持原行为：全部会话全量返回', () => {
    const messages = [msg({ text: 'a', sessionId: 's_1' }), msg({ text: 'b' })];
    expect(filterMessages({ ...base, messages, filterOn: false, projectId: null }).map((m) => m.text)).toEqual(['a', 'b']);
  });
});

describe('filterSessionsByProject', () => {
  it('只保留归属当前目录的会话；未选目录时全量', () => {
    const sessions = [{ id: 's_1' }, { id: 's_2' }, { id: 's_3' }];
    expect(filterSessionsByProject(sessions, 'p1', { s_1: 'p1' }, { s_2: 'p2' }).map((s) => s.id)).toEqual(['s_1']);
    expect(filterSessionsByProject(sessions, null, {}, {}).map((s) => s.id)).toEqual(['s_1', 's_2', 's_3']);
  });
});
