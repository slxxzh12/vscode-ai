import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseStats, parseNum, collectAgentStats, resolveAgentBin, ensureAgentOnPath } from '../collaboration/agent-stats.js';

const SAMPLE = [
  '│Sessions                                             21 │',
  '│Messages                                          3,986 │',
  '│Days                                                  7 │',
  '│Total Cost                                        $4.83 │',
  '│Input                                              8.2M │',
  '│Output                                             1.0M │',
  '│Cache Read                                       983.0M │',
  '│Cache Write                                           0 │',
].join('\n');

test('parseNum 支持 K/M/B 与千分位', () => {
  assert.equal(parseNum('8.2M'), 8200000);
  assert.equal(parseNum('3,986'), 3986);
  assert.equal(parseNum('983.0M'), 983000000);
  assert.equal(parseNum('$4.83'), 4.83);
  assert.equal(parseNum('abc'), null);
});

test('parseStats 提取关键字段', () => {
  const s = parseStats(SAMPLE);
  assert.equal(s.sessions, 21);
  assert.equal(s.messages, 3986);
  assert.equal(s.days, 7);
  assert.equal(s.totalCost, 4.83);
  assert.equal(s.input, 8200000);
  assert.equal(s.output, 1000000);
  assert.equal(s.cacheRead, 983000000);
  assert.equal(s.cacheWrite, 0);
});

test('collectAgentStats 命令不存在返回 error', async () => {
  const r = await collectAgentStats({ cmd: 'definitely-not-a-cmd-xyz', env: { PATH: '' } });
  assert.ok(r.error);
  assert.equal(r.agent, 'definitely-not-a-cmd-xyz');
});

test('collectAgentStats：非零退出重试，成功即返回', async () => {
  let calls = 0;
  const r = await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {},
    execFileFn: (bin, args, opts, cb) => {
      calls += 1;
      if (calls < 3) cb(Object.assign(new Error('Command failed'), { code: 'ERR' }), '', '');
      else cb(null, SAMPLE, '');
    },
  });
  assert.equal(calls, 3);
  assert.equal(r.sessions, 21);
  assert.equal(r.error, undefined);
});

test('collectAgentStats：ENOENT 不重试，直接返回 error', async () => {
  let calls = 0;
  const r = await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {},
    execFileFn: (bin, args, opts, cb) => { calls += 1; cb(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), '', ''); },
  });
  assert.equal(calls, 1);
  assert.ok(r.error);
  assert.equal(r.agent, 'opencode');
});

test('resolveAgentBin：DEVFLOW_OPENCODE 显式配置优先（仅对 opencode 生效）', () => {
  const bin = path.join('C:', 'tools', 'opencode.exe');
  const env = { PATH: '', DEVFLOW_OPENCODE: bin };
  assert.equal(resolveAgentBin('opencode', { env, exists: (p) => p === bin, appRoot: '' }), bin);
  // 非 opencode 命令不吃这个覆盖
  assert.equal(resolveAgentBin('nga.cmd', { env, exists: (p) => p === bin, appRoot: '' }), 'nga.cmd');
});

test('resolveAgentBin：按 PATH 命中；PATH 没有时退回包内 opencode/、env/', () => {
  const dir = path.join('C:', 'bin');
  const inPath = path.join(dir, 'opencode.exe');
  assert.equal(
    resolveAgentBin('opencode.exe', { env: { PATH: dir }, exists: (p) => p === inPath, appRoot: '' }),
    inPath,
  );
  const appRoot = path.join('D:', 'pkg');
  const bundled = path.join(appRoot, 'opencode', 'opencode.exe');
  assert.equal(
    resolveAgentBin('opencode.exe', { env: { PATH: '' }, exists: (p) => p === bundled, appRoot }),
    bundled,
  );
  assert.equal(resolveAgentBin('opencode.exe', { env: { PATH: '' }, exists: () => false, appRoot }), 'opencode.exe');
});

test('resolveAgentBin：本身是路径时原样返回', () => {
  const p = path.join('D:', 'soft', 'opencode.exe');
  assert.equal(resolveAgentBin(p, { env: { PATH: '' }, exists: () => false }), p);
});

test('ensureAgentOnPath：命中后把目录插到 PATH 最前且不重复', () => {
  const bin = path.join('C:', 'tools', 'oc', 'opencode.exe');
  const env = { PATH: '/other', DEVFLOW_OPENCODE: bin };
  assert.equal(ensureAgentOnPath('opencode', { env, exists: (p) => p === bin }), bin);
  assert.equal(env.PATH, path.dirname(bin) + path.delimiter + '/other');
  assert.equal(ensureAgentOnPath('opencode', { env, exists: (p) => p === bin }), bin);
  assert.equal(env.PATH, path.dirname(bin) + path.delimiter + '/other', '已在 PATH 里不重复插入');
});
