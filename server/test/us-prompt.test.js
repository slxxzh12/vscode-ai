import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectUsDocs, renderUsPrompt } from '../pipeline/us-prompt.js';

function tmpUs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-prompt-'));
}

test('us-prompt：只收集 md/json/txt，跳过符号链接', () => {
  const dir = tmpUs();
  fs.writeFileSync(path.join(dir, '01-需求分析.md'), '# 需求', 'utf8');
  fs.writeFileSync(path.join(dir, 'pipeline.json'), '{"build":"npm run build"}', 'utf8');
  fs.writeFileSync(path.join(dir, 'skip.png'), 'x', 'utf8');
  const r = collectUsDocs(dir);
  assert.deepEqual(r.docs.map((d) => d.rel).sort(), ['01-需求分析.md', 'pipeline.json']);
  assert.equal(r.truncated, false);
});

test('us-prompt：超过 200KB 截断并标记', () => {
  const dir = tmpUs();
  fs.writeFileSync(path.join(dir, 'big.md'), 'x'.repeat(210 * 1024), 'utf8');
  const r = collectUsDocs(dir);
  assert.equal(r.truncated, true);
  assert.ok(r.bytes <= 200 * 1024);
});

test('us-prompt：模板占位符全部替换', () => {
  const text = renderUsPrompt('US={{us}} B={{branch}} C={{cwd}}\n{{docs}}\n{{build}}', {
    us: 'US000001-2021-A',
    branch: 'feature/zhangsan',
    cwd: '/repo',
    docs: [{ rel: 'a.md', text: '# A' }],
    commands: { build: 'npm run build', test: '', package: '' },
  });
  assert.match(text, /US=US000001-2021-A/);
  assert.match(text, /B=feature\/zhangsan/);
  assert.match(text, /C=\/repo/);
  assert.match(text, /### a\.md/);
  assert.match(text, /npm run build/);
});
