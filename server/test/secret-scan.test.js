import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSecrets } from '../secret-scan.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfsecret-')); }
function w(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('scanSecrets 命中私钥、令牌与带凭据 URL 并脱敏', async () => {
  const dir = tmp();
  w(dir, 'src/a.js', [
    'const ok = 1;',
    'const u = "https://user:pass@example.com/repo";',
    'const t = "ghp_123456789012345678901234567890123456";',
    '-----BEGIN RSA PRIVATE KEY-----',
    'const doc = "https://<user>:<token>@gitee.com/x";',
  ].join('\n'));
  const r = await scanSecrets({ dir });
  assert.equal(r.totals.findings, 3);
  const rules = r.byRule.map((x) => x.rule).sort();
  assert.deepEqual(rules, ['credential-url', 'github-token', 'private-key']);
  const url = r.findings.find((f) => f.rule === 'credential-url');
  assert.equal(url.line, 2);
  assert.equal(url.rel, 'src/a.js');
  assert.ok(!url.match.includes('pass@example'), '凭据应脱敏');
  assert.ok(url.match.includes('…'));
  assert.deepEqual(r.totals.files, 1);
  assert.equal(r.scanned, 1);
});

test('scanSecrets secret-assignment 跳过占位符与 env 引用', async () => {
  const dir = tmp();
  w(dir, 'a.env', [
    'PASSWORD=changeme',
    'TOKEN="${TOKEN}"',
    'API_KEY=xxxxxxxx',
    'SECRET=real-secret-value',
  ].join('\n'));
  const r = await scanSecrets({ dir });
  const assigns = r.findings.filter((f) => f.rule === 'secret-assignment');
  assert.equal(assigns.length, 1);
  assert.equal(assigns[0].line, 4);
  assert.equal(assigns[0].severity, 'medium');
});

test('scanSecrets 跳过隐藏目录、硬排除目录与用户排除目录', async () => {
  const dir = tmp();
  const secret = 'https://u:p@host/x';
  w(dir, '.git/config', secret);
  w(dir, 'node_modules/pkg/a.js', secret);
  w(dir, 'env/real.env', secret);
  w(dir, 'tools/keep.txt', secret);
  w(dir, 'custom/skip.js', secret);
  const r = await scanSecrets({ dir, excludeDirs: ['custom'] });
  assert.deepEqual(r.findings.map((f) => f.rel), ['tools/keep.txt']);
});

test('scanSecrets 跳过二进制与超大文件', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.from([0, 65, 75, 73, 65]));
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(2 * 1024 * 1024 + 1));
  w(dir, 'a.png', 'AKIA1234567890123456');
  const r = await scanSecrets({ dir });
  assert.equal(r.findings.length, 0);
  assert.equal(r.scanned, 0);
});

test('scanSecrets 空命中返回干净结果', async () => {
  const dir = tmp();
  w(dir, 'a.js', 'const a = 1;\n');
  const r = await scanSecrets({ dir });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.byRule, []);
  assert.deepEqual(r.totals, { files: 0, findings: 0, scanned: 1 });
});

test('scanSecrets 非目录/不存在 → not-found；空 dir → bad-dir', async () => {
  const dir = tmp();
  w(dir, 'a.js', 'x');
  await assert.rejects(() => scanSecrets({ dir: path.join(dir, 'nope') }), (e) => e.code === 'not-found');
  await assert.rejects(() => scanSecrets({ dir: '' }), (e) => e.code === 'bad-dir');
  await assert.rejects(() => scanSecrets({}), (e) => e.code === 'bad-dir');
});
