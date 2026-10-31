import { describe, it, expect } from 'vitest';
import { parseComposer, splitAtCommand, filterMentions, highlightMentions } from './chat-parser';

describe('chat-parser', () => {
  it('filterMentions 按关键词过滤群成员', () => {
    const members = [
      { machineId: 'a', username: 'alice' },
      { machineId: 'b', username: 'bob' },
    ];
    expect(filterMentions(members, 'a').map((m) => m.username)).toEqual(['alice']);
    expect(filterMentions(members, '').map((m) => m.username)).toEqual(['alice', 'bob']);
  });

  it('isCommand 判定 /command 前缀', () => {
    expect(parseComposer('/command 跑测试', { machineId: 'b', username: 'bob' }).isCommand).toBe(true);
    expect(parseComposer('hello world', { machineId: 'b', username: 'bob' }).isCommand).toBe(false);
  });

  it('isCommand 但缺 @ 目标时返回 missingTarget', () => {
    const r = parseComposer('/command 跑测试', null);
    expect(r.isCommand).toBe(true);
    expect(r.missingTarget).toBe(true);
  });

  it('splitAtCommand 把 @目标 与正文分开', () => {
    const seg = splitAtCommand('@bob 帮我看看', 'bob', 'b-id');
    expect(seg.toId).toBe('b-id');
    expect(seg.text).toBe('帮我看看');
  });

  it('消息渲染成 @别名 高亮段', () => {
    const segs = highlightMentions('@bob 帮我看看', { 'b-id': 'bob' });
    expect(segs.some((s) => s.mention)).toBe(true);
  });
});
