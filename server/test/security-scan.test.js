import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSecurityDirs } from '../security/scan.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-security-'));
}

test('安全扫描：识别 token、私钥、凭据 URL 与危险文件', () => {
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, 'clean.js'), 'const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'secret.js'), 'const token = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'key.pem'), '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.env'), 'PASSWORD=real-secret-value\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'env'));
  fs.writeFileSync(path.join(dir, 'env', 'gitee.ini'), 'token=abc\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'const t = "ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";\n', 'utf8');

  const r = scanSecurityDirs([dir]);
  const rules = r.findings.map((f) => f.rule);
  assert.ok(rules.includes('github-token'));
  assert.ok(rules.includes('private-key'));
  assert.ok(rules.includes('dangerous-file'));
  assert.ok(rules.includes('env-dir'));
  assert.equal(r.findings.some((f) => f.path.includes('node_modules')), false);
  assert.ok(r.summary.high >= 2);
  assert.ok(r.scanned.files >= 4);
});

test('安全扫描：干净目录无发现', () => {
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n', 'utf8');
  const r = scanSecurityDirs([dir]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.total, 0);
});

test('安全扫描：不存在的目录被跳过', () => {
  const r = scanSecurityDirs([path.join(tmpRoot(), 'missing')]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.scanned.dirs, 0);
});
