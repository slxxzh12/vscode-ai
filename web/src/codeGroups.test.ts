import { describe, it, expect } from 'vitest';
import { groupSlices } from './codeGroups';

describe('groupSlices', () => {
  it('按成员分组求和并降序', () => {
    const rows = [{ key: 'Ann', value: 10 }, { key: 'Bob', value: 5 }, { key: 'Cat', value: 7 }];
    expect(groupSlices(rows, { Ann: 'A组', Cat: 'A组', Bob: 'B组' })).toEqual([
      { name: 'A组', value: 17 }, { name: 'B组', value: 5 },
    ]);
  });
  it('未归属归到空名并排最后', () => {
    const rows = [{ key: 'Ann', value: 10 }, { key: 'Dan', value: 3 }, { key: 'Eve', value: 1 }];
    expect(groupSlices(rows, { Ann: 'A组' })).toEqual([{ name: 'A组', value: 10 }, { name: '', value: 4 }]);
  });
  it('空输入返回空数组', () => {
    expect(groupSlices([], {})).toEqual([]);
  });
  it('值为 0 的组保留', () => {
    expect(groupSlices([{ key: 'Ann', value: 0 }], { Ann: 'A组' })).toEqual([{ name: 'A组', value: 0 }]);
  });
});
