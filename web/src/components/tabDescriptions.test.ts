import { test, expect } from 'vitest';
import { setTabDescription } from './tabDescriptions';

test('setTabDescription：非空写入并 trim；空/纯空白删除；不改原对象', () => {
  const base = { a: 'x' };
  const r1 = setTabDescription(base, 'b', '  hi  ');
  expect(r1).toEqual({ a: 'x', b: 'hi' });
  expect(base).toEqual({ a: 'x' });

  const r2 = setTabDescription({ a: 'x' }, 'a', '   ');
  expect(r2).toEqual({});

  const r3 = setTabDescription({}, 'c', '');
  expect(r3).toEqual({});
});
