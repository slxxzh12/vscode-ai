import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { docsRepoRootOf, ensureDocsAgents, DOCS_AGENTS_MARKER } from '../docs-agents.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-docs-agents-'));
}

test('docs-agents: docsRepoRootOf resolves the repo containing docs/', () => {
  assert.equal(docsRepoRootOf('D:/repo/docs/version'), 'D:/repo');
  assert.equal(docsRepoRootOf('D:\\repo\\docs\\version'), 'D:\\repo');
  assert.equal(docsRepoRootOf('D:/repo'), 'D:/repo');
  assert.equal(docsRepoRootOf({ code: 'D:/repo', solution: 'D:/repo/docs/version' }), 'D:/repo');
});

test('docs-agents: creates AGENTS.md with solution naming rules', () => {
  const root = tmpRoot();
  const r = ensureDocsAgents(root);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'created');
  const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.ok(text.includes(DOCS_AGENTS_MARKER));
  assert.match(text, /方案编号-日期-方案名称/);
  assert.match(text, /docs\/version/);
  assert.match(text, /YYYYMMDD/);
});

test('docs-agents: append once and keep existing content', () => {
  const root = tmpRoot();
  const file = path.join(root, 'AGENTS.md');
  fs.writeFileSync(file, '# Project rules\n\nKEEP ME\n', 'utf8');
  const a = ensureDocsAgents(root);
  assert.equal(a.action, 'appended');
  const b = ensureDocsAgents(root);
  assert.equal(b.action, 'exists');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /KEEP ME/);
  assert.equal(text.split(DOCS_AGENTS_MARKER).length - 1, 1);
});
