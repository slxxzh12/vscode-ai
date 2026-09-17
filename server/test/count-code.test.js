import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripComments, countReal, walk, buildReport, formatReport, groupKey } from '../../scripts/count-code.js';

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

test('groupKey 归类 server/test、顶层目录与根文件', () => {
  assert.equal(groupKey('server/test/a.test.js'), 'server/test');
  assert.equal(groupKey('server/http-api.js'), 'server');
  assert.equal(groupKey('web/src/App.vue'), 'web');
  assert.equal(groupKey('README.md'), '(root)');
});

test('walk 递归收集允许扩展名，跳过隐藏目录与构建产物', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-count-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, '.hidden'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.md'), 'skip me\n');
  fs.writeFileSync(path.join(dir, '.hidden', 'x.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'node_modules', 'y.js'), 'const y = 1;\n');
  fs.writeFileSync(path.join(dir, 'dist', 'z.js'), 'const z = 1;\n');
  const found = walk(dir).map((p) => path.relative(dir, p).replace(/\\/g, '/'));
  assert.deepEqual(found, ['src/a.js']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildReport + formatReport 统计真实行数并汇总分组', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-count-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// c\nconst a = 1;\n\n');
  fs.writeFileSync(path.join(dir, 'server', 'b.js'), 'const b = 1;\nconst c = 2;\n');
  const { rows, groups } = buildReport(dir);
  assert.deepEqual(rows.map((r) => r.rel).sort(), ['server/b.js', 'src/a.js']);
  assert.equal(rows.find((r) => r.rel === 'src/a.js').real, 1);
  const text = formatReport({ rows, groups });
  assert.match(text, /REAL\s+TOTAL\s+FILE/);
  assert.match(text, /src\/a\.js/);
  assert.match(text, /server\/b\.js/);
  assert.match(text, /^ALL\s/m);
  assert.match(text, /^src\s/m);
  assert.match(text, /^server\s/m);
  fs.rmSync(dir, { recursive: true, force: true });
});
