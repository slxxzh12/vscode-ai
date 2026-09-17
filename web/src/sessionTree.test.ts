import { describe, it, expect } from 'vitest';
import { buildSessionTree } from './sessionTree';

const m = (over: Record<string, unknown>) => ({ text: 'x', ts: 0, ...over });

describe('buildSessionTree', () => {
  it('按 sessionId 分组，组内倒序，标签取最新 tabName', () => {
    const tree = buildSessionTree([
      m({ text: 'b2', ts: 20, sessionId: 's1', tabName: '新名' }),
      m({ text: 'a1', ts: 10, sessionId: 's2', tabName: 'A' }),
      m({ text: 'b1', ts: 5, sessionId: 's1', tabName: '旧名' }),
    ]);
    expect(tree.map((n) => n.label)).toEqual(['新名', 'A']);
    expect(tree[0].sessionId).toBe('s1');
    expect(tree[0].messages.map((x) => x.text)).toEqual(['b2', 'b1']);
  });

  it('无 sessionId 回退 tabName；两者都无归未知会话且不可恢复', () => {
    const tree = buildSessionTree([
      m({ text: 'n', ts: 3, tabName: 'byName' }),
      m({ text: 'u', ts: 2 }),
    ], '未知会话');
    const byName = tree.find((n) => n.label === 'byName')!;
    expect(byName.sessionId).toBeNull();
    expect(byName.key).toBe('name:byName');
    const unknown = tree.find((n) => n.label === '未知会话')!;
    expect(unknown.sessionId).toBeNull();
    expect(unknown.key).toBe('__unknown__');
  });

  it('组间按组内最新消息时间倒序', () => {
    const tree = buildSessionTree([
      m({ text: 'old', ts: 1, sessionId: 's1' }),
      m({ text: 'new', ts: 9, sessionId: 's2' }),
    ]);
    expect(tree.map((n) => n.sessionId)).toEqual(['s2', 's1']);
  });
});
