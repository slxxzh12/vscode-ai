import { describe, it, expect } from 'vitest';
import { EXTRA_CHIPS, buildChips, appendText } from './phaseChips';

describe('phaseChips', () => {
  it('固定附加项内容与顺序', () => {
    expect(EXTRA_CHIPS).toEqual(['1', '2', '3', '4', '5', 'ok']);
  });

  it('阶段提示为替换型(append:false)、固定附加项为追加型(append:true)', () => {
    expect(buildChips([])).toEqual([
      { text: '1', append: true }, { text: '2', append: true }, { text: '3', append: true },
      { text: '4', append: true }, { text: '5', append: true }, { text: 'ok', append: true },
    ]);
    expect(buildChips(undefined).every((c) => c.append)).toBe(true);
    expect(buildChips(null)).toHaveLength(6);
  });

  it('阶段提示在前、附加项在后', () => {
    expect(buildChips(['执行/compact 命令', '合并到 master'])).toEqual([
      { text: '执行/compact 命令', append: false },
      { text: '合并到 master', append: false },
      { text: '1', append: true }, { text: '2', append: true }, { text: '3', append: true },
      { text: '4', append: true }, { text: '5', append: true }, { text: 'ok', append: true },
    ]);
  });

  it('去重时阶段提示优先（同文本保留 append:false）', () => {
    expect(buildChips(['ok', '1', '继续'])).toEqual([
      { text: 'ok', append: false },
      { text: '1', append: false },
      { text: '继续', append: false },
      { text: '2', append: true }, { text: '3', append: true }, { text: '4', append: true }, { text: '5', append: true },
    ]);
  });

  it('忽略非字符串与空白项，并 trim', () => {
    expect(buildChips(['  ok  ', '', '   ', 42 as unknown as string, null as unknown as string]).map((c) => c.text))
      .toEqual(['ok', '1', '2', '3', '4', '5']);
  });
});

describe('appendText', () => {
  it('空文本直接取追加内容', () => {
    expect(appendText('', '1')).toBe('1');
    expect(appendText('', 'ok')).toBe('ok');
  });

  it('已有内容时用空格分隔追加（可连续点多个）', () => {
    expect(appendText('1', 'ok')).toBe('1 ok');
    expect(appendText('1 ok', '2')).toBe('1 ok 2');
  });

  it('末尾已是空白则不再补空格（含换行）', () => {
    expect(appendText('1 ', 'ok')).toBe('1 ok');
    expect(appendText('1\n', 'ok')).toBe('1\nok');
  });

  it('追加内容 trim，空白内容不改变原文', () => {
    expect(appendText('1', '  ok  ')).toBe('1 ok');
    expect(appendText('1', '   ')).toBe('1');
    expect(appendText('', '   ')).toBe('');
  });
});
