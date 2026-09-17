import { describe, it, expect } from 'vitest';
import { EXTRA_CHIPS, buildChips } from './phaseChips';

describe('phaseChips', () => {
  it('固定附加项内容与顺序', () => {
    expect(EXTRA_CHIPS).toEqual(['1', '2', '3', '4', '5', 'ok']);
  });

  it('阶段无提示时只有附加项', () => {
    expect(buildChips([])).toEqual(['1', '2', '3', '4', '5', 'ok']);
    expect(buildChips(undefined)).toEqual(['1', '2', '3', '4', '5', 'ok']);
    expect(buildChips(null)).toEqual(['1', '2', '3', '4', '5', 'ok']);
  });

  it('阶段提示在前、附加项在后', () => {
    expect(buildChips(['执行/compact 命令', '合并到 master'])).toEqual([
      '执行/compact 命令', '合并到 master', '1', '2', '3', '4', '5', 'ok',
    ]);
  });

  it('去重：阶段里已配过的附加项不再重复', () => {
    expect(buildChips(['ok', '1', '继续'])).toEqual(['ok', '1', '继续', '2', '3', '4', '5']);
  });

  it('忽略非字符串与空白项，并 trim', () => {
    expect(buildChips(['  ok  ', '', '   ', 42 as unknown as string, null as unknown as string])).toEqual(['ok', '1', '2', '3', '4', '5']);
  });
});
