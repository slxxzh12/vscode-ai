import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSecrets } from '../secret-scan.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-sec-')); }

test('敏感配置关键词：带前缀的 PASSWORD/TOKEN/API_KEY 能命中并分类', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.env'), 'DB_PASSWORD=SuperSecret123\nGITHUB_TOKEN=abc123def456\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'const api_key = "abcdef123456";\nconst tokenizer = 1;\nconst token_type = "bearer";\n');
  const r = await scanSecrets({ dir });
  const cats = new Set(r.findings.map((f) => f.category));
  assert.ok(cats.has('password'));
  assert.ok(cats.has('token'));
  assert.ok(cats.has('key'));
  // tokenizer / token_type 不应误报
  assert.equal(r.findings.some((f) => f.rel === 'app.js' && f.line === 2), false);
  assert.equal(r.findings.some((f) => f.rel === 'app.js' && f.line === 3), false);
  // 同类归并
  assert.ok(Array.isArray(r.byCategory) && r.byCategory.length >= 1);
  assert.equal(r.byCategory.reduce((s, c) => s + c.count, 0), r.findings.length);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('敏感配置关键词：占位符不报', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'x.yml'), 'password: "changeme"\napi_key: "your_api_key_here"\n');
  const r = await scanSecrets({ dir });
  assert.equal(r.findings.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('敏感配置关键词：连接串/凭据分类', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'conf.json'), '{\n  "database_url": "postgres://u:realpass@db:5432/app",\n  "redis_url": "redis://:realpass@cache:6379/0"\n}\n');
  const r = await scanSecrets({ dir });
  const cats = new Set(r.findings.map((f) => f.category));
  assert.ok(cats.has('connection'));
  fs.rmSync(dir, { recursive: true, force: true });
});
