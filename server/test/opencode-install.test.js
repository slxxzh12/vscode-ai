import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createOpencodeInstaller,
  detectAgents,
  persistUserPath,
} from '../opencode-install.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-opencode-'));
}

function makeZip(name, data) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = zlib.crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

test('detectAgents finds opencode in the app soft directory', () => {
  const appRoot = tmpDir();
  const softDir = path.join(appRoot, 'soft');
  fs.mkdirSync(softDir, { recursive: true });
  fs.writeFileSync(path.join(softDir, 'opencode.exe'), 'x');
  const found = detectAgents([], { appRoot, env: { PATH: '' } });
  assert.ok(found.some((a) => a.cmd === 'opencode' && a.path === path.join(softDir, 'opencode.exe')));
  fs.rmSync(appRoot, { recursive: true, force: true });
});

test('installer downloads, extracts, and adds soft to PATH', async () => {
  const appRoot = tmpDir();
  const zip = makeZip('opencode.exe', Buffer.from('fake-opencode'));
  const env = { PATH: '' };
  let persisted = '';
  const installer = createOpencodeInstaller({
    appRoot,
    platform: 'win32',
    arch: 'x64',
    env,
    agents: () => [],
    fetchFn: async () => new Response(zip, {
      status: 200,
      headers: { 'content-length': String(zip.length) },
    }),
    persistPath: async (dir) => { persisted = dir; return true; },
    logger: { warn() {}, info() {} },
  });

  const before = installer.status();
  assert.equal(before.anyInstalled, false);
  assert.equal(before.supported, true);

  const started = installer.start();
  assert.equal(started.download.state, 'downloading');

  const done = await installer.install();
  const target = path.join(appRoot, 'soft', 'opencode.exe');
  assert.equal(done.download.state, 'done');
  assert.equal(done.download.path, target);
  assert.equal(done.download.percent, 100);
  assert.equal(done.anyInstalled, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'fake-opencode');
  assert.equal(env.PATH.split(path.delimiter)[0], path.join(appRoot, 'soft'));
  assert.equal(persisted, path.join(appRoot, 'soft'));
  assert.equal(fs.readdirSync(path.join(appRoot, 'soft')).some((n) => n.endsWith('.zip')), false);

  fs.rmSync(appRoot, { recursive: true, force: true });
});

test('persistUserPath runs PowerShell on Windows only', async () => {
  const calls = [];
  const ok = await persistUserPath('C:\\soft', {
    platform: 'win32',
    env: { PATH: '' },
    execFileFn: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); },
  });
  assert.equal(ok, true);
  assert.equal(calls[0].cmd, 'powershell.exe');
  assert.equal(calls[0].opts.env.DF_OPENCODE_PATH, 'C:\\soft');
  assert.equal(calls[0].opts.windowsHide, true);

  assert.equal(await persistUserPath('C:\\soft', { platform: 'linux' }), false);
});
