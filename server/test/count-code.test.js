import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments, countReal } from '../../scripts/count-code.js';

test('stripComments removes comments but preserves string literals', () => {
  const src = [
    'const url = "https://example.com";',
    'const re = /a\\/\\/b/;',
    '// line comment',
    '/* block',
    '   comment */ const x = 1;',
    'const y = 2; // trailing',
    '<!-- html comment -->',
    'const z = 3;',
  ].join('\n');
  const out = stripComments(src);
  assert.match(out, /https:\/\/example\.com/);
  assert.doesNotMatch(out, /line comment/);
  assert.doesNotMatch(out, /block/);
  assert.doesNotMatch(out, /trailing/);
  assert.doesNotMatch(out, /html comment/);
  assert.match(out, /const x = 1;/);
  assert.match(out, /const z = 3;/);
});

test('countReal drops blanks, brace-only and non-latin lines', () => {
  const src = ['{', '}', '', '   ', ');', '中文', 'const a = 1;', 'foo();'].join('\n');
  assert.deepEqual(countReal(src), { total: 8, real: 2 });
});

test('countReal keeps comment-stripped line positions', () => {
  const src = ['/* one', 'two', 'three */', 'const a = 1;'].join('\n');
  assert.deepEqual(countReal(src), { total: 4, real: 1 });
});
