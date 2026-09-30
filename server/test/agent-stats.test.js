import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { parseStats, parseNum, parseStatsCmd, collectAgentStats, probeAgentStats, resolveAgentBin, ensureAgentOnPath, isClaudeFamily, collectClaudeStats, resolveStatsCwd } from '../collaboration/agent-stats.js';

function claudeHome(linesByFile) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'df-claude-'));
  const dir = path.join(home, '.claude', 'projects', 'D--proj-app');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, lines] of Object.entries(linesByFile)) {
    fs.writeFileSync(path.join(dir, name), lines.join('\n'), 'utf8');
  }
  return home;
}

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

test('parseStats：取最后一次出现的指标，忽略前面的噪音与旧值', () => {
  const noisy = ['error: stats failed', 'Messages 1', 'Sessions 2', 'Total Cost $9.99', SAMPLE].join('\n');
  const s = parseStats(noisy);
  assert.equal(s.sessions, 21, '取末尾 SAMPLE 里的 21，而不是前面的 2');
  assert.equal(s.messages, 3986);
  assert.equal(s.totalCost, 4.83);
});

test('collectAgentStats 命令不存在返回 error', async () => {
  const r = await collectAgentStats({ cmd: 'definitely-not-a-cmd-xyz', env: { PATH: '' } });
  assert.ok(r.error);
  assert.equal(r.agent, 'definitely-not-a-cmd-xyz');
});

test('isClaudeFamily：claudecode/codeagent 命中，其余不命中', () => {
  assert.equal(isClaudeFamily('claudecode'), true);
  assert.equal(isClaudeFamily('C:\\tools\\codeagent.cmd'), true);
  assert.equal(isClaudeFamily('opencode'), false);
  assert.equal(isClaudeFamily('nga'), false);
});

test('collectClaudeStats：解析 ~/.claude/projects/*.jsonl 的 sessions/messages/input/output', () => {
  const home = claudeHome({
    'sess1.jsonl': [
      JSON.stringify({ type: 'user', sessionId: 'sess1', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'assistant', sessionId: 'sess1', model: 'claude-sonnet', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 } }),
      JSON.stringify({ type: 'tool_use', sessionId: 'sess1' }),
      JSON.stringify({ type: 'assistant', sessionId: 'sess1', model: 'claude-sonnet', usage: { input_tokens: 30, output_tokens: 10 } }),
    ],
  });
  const m = collectClaudeStats({ home, days: 60 });
  assert.equal(m.sessions, 1, '每个 jsonl = 1 个 session');
  assert.equal(m.messages, 4, '每行一条 message 事件');
  assert.equal(m.input, 130);
  assert.equal(m.output, 30);
  assert.equal(m.cacheRead, 5);
  assert.equal(m.cacheWrite, 2);
  assert.deepEqual(m.byModel['claude-sonnet'], { input: 130, output: 30 });
});

test('collectAgentStats：claudecode 走本机日志解析，不启 CLI', async () => {
  const home = claudeHome({
    'a.jsonl': [JSON.stringify({ type: 'assistant', sessionId: 'a', usage: { input_tokens: 7, output_tokens: 3 } })],
  });
  let spawned = false;
  const r = await collectAgentStats({ cmd: 'claudecode', home, execFileFn: () => { spawned = true; throw new Error('should not spawn'); } });
  assert.equal(spawned, false);
  assert.equal(r.agent, 'claudecode');
  assert.equal(r.sessions, 1);
  assert.equal(r.messages, 1);
  assert.equal(r.input, 7);
  assert.equal(r.output, 3);
});

test('probeAgentStats：claudecode 返回文件解析结果且 ok', async () => {
  const home = claudeHome({
    'a.jsonl': [JSON.stringify({ type: 'assistant', sessionId: 'a', usage: { input_tokens: 11, output_tokens: 4 } })],
  });
  const r = await probeAgentStats({ cmd: 'codeagent', home });
  assert.equal(r.ok, true);
  assert.equal(r.parsed.input, 11);
  assert.equal(r.parsed.output, 4);
  assert.match(r.cmdline, /jsonl/);
});

test('collectAgentStats：默认用 resolveStatsCwd 作为执行目录并注入 skip-safe-check', async () => {
  let seen = null;
  await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {}, resolveCwd: () => '/git/root',
    execFileFn: (bin, args, opts, cb) => { seen = opts; cb(null, SAMPLE, ''); },
  });
  assert.equal(seen.cwd, '/git/root');
  assert.equal(seen.env.OPENCODE_SKIP_SAFE_CHECK, '1');
});

test('collectAgentStats：startDir 传给 resolveCwd（从选中目录向下找 .git）', async () => {
  let seenArgs = null;
  await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {},
    startDir: '/selected/root',
    resolveCwd: (args) => { seenArgs = args; return '/git/root'; },
    execFileFn: (bin, args, opts, cb) => { cb(null, SAMPLE, ''); },
  });
  assert.equal(seenArgs.startDir, '/selected/root');
  assert.equal(seenArgs.home, os.homedir());
});

test('probeAgentStats：startDir 传给 resolveCwd', async () => {
  let seenArgs = null;
  await probeAgentStats({
    cmd: 'opencode', env: { PATH: '' },
    startDir: '/selected/root',
    resolveCwd: (args) => { seenArgs = args; return '/git/root'; },
    execFileFn: (bin, args, opts, cb) => { cb(null, SAMPLE, ''); },
  });
  assert.equal(seenArgs.startDir, '/selected/root');
});

test('resolveStatsCwd：当前目录含 .git 直接命中', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-git-'));
  fs.mkdirSync(path.join(root, '.git'));
  assert.equal(resolveStatsCwd({ startDir: root, home: '/home/u', exists: fs.existsSync }), root);
});

test('resolveStatsCwd：子目录含 .git 向下命中', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-git-'));
  const sub = path.join(root, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(sub, '.git'));
  assert.equal(resolveStatsCwd({ startDir: root, home: '/home/u', exists: fs.existsSync }), sub);
});

test('resolveStatsCwd：无 .git 时回退 home', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-nogit-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  assert.equal(resolveStatsCwd({ startDir: root, home: '/home/u', exists: fs.existsSync }), '/home/u');
});

test('resolveStatsCwd：worktree 的 .git 文件也算命中', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-wt-'));
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
  assert.equal(resolveStatsCwd({ startDir: root, home: '/home/u', exists: fs.existsSync }), root);
});

test('collectAgentStats：默认只跑一次（不重试），失败带 error 与回退原文', async () => {
  let calls = 0;
  const r = await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {},
    execFileFn: (bin, args, opts, cb) => { calls += 1; cb(Object.assign(new Error('Command failed'), { code: 'ERR' }), '', ''); },
  });
  assert.equal(calls, 1);
  assert.equal(r.error, 'Command failed');
  assert.equal(r.code, 'ERR');
});

test('collectAgentStats：配 attempts=3 时非零退出重试，成功即返回', async () => {
  let calls = 0;
  const r = await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {}, attempts: 3,
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

test('parseStatsCmd：{days} 展开、首段解析可执行文件、空模板返回 null', () => {
  const spec = parseStatsCmd('opencode stats --days {days}', 7, { env: { PATH: '' }, exists: () => false });
  assert.deepEqual(spec, { bin: 'opencode', args: ['stats', '--days', '7'] });
  assert.equal(parseStatsCmd('', 7), null);
  assert.equal(parseStatsCmd('   ', 7), null);
});

test('collectAgentStats：配了 statsCmd 走模板，agent 仍记 cmd', async () => {
  const calls = [];
  const r = await collectAgentStats({
    cmd: 'claudecode', statsCmd: 'claudecode usage --days {days}', env: { PATH: '' }, sleepFn: async () => {},
    execFileFn: (bin, args, opts, cb) => { calls.push([bin, args]); cb(null, SAMPLE, ''); },
  });
  assert.deepEqual(calls[0], ['claudecode', ['usage', '--days', '60']]);
  assert.equal(r.agent, 'claudecode');
  assert.equal(r.sessions, 21);
  assert.equal(r.raw, SAMPLE, '本地保留原文供采集信息弹窗');
  assert.match(r.cmdline, /claudecode usage --days 60$/);
});

test('collectAgentStats：Windows 上 .cmd 用 cmd.exe /d /s /c 包装（CVE-2024-27980）', { skip: process.platform !== 'win32' }, async () => {
  const calls = [];
  await collectAgentStats({
    cmd: 'nga', statsCmd: 'C:/tools/nga.cmd stats --days {days}', env: { PATH: '' }, sleepFn: async () => {},
    execFileFn: (bin, args, opts, cb) => { calls.push([bin, args]); cb(null, SAMPLE, ''); },
  });
  assert.equal(calls[0][0], process.env.ComSpec || 'cmd.exe');
  assert.deepEqual(calls[0][1], ['/d', '/s', '/c', 'C:/tools/nga.cmd', 'stats', '--days', '60']);
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

test('probeAgentStats：只跑一次，返回命令行 + 原文 + 解析结果', async () => {
  let calls = 0;
  const r = await probeAgentStats({
    cmd: 'opencode', statsCmd: 'opencode stats --days {days}', days: 7, env: { PATH: '' },
    execFileFn: (bin, args, opts, cb) => { calls += 1; cb(null, SAMPLE, ''); },
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, true);
  assert.equal(r.error, '');
  assert.match(r.cmdline, /opencode stats --days 7$/);
  assert.equal(r.raw, SAMPLE);
  assert.equal(r.parsed.sessions, 21);
  assert.equal(r.parsed.input, 8200000);
});

test('probeAgentStats：命令失败时带上 stderr/错误码，仍是单次调用', async () => {
  let calls = 0;
  const r = await probeAgentStats({
    cmd: 'opencode', env: { PATH: '' },
    execFileFn: (bin, args, opts, cb) => { calls += 1; cb(Object.assign(new Error('boom'), { code: 7 }), '', 'fatal: bad\n'); },
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'boom');
  assert.equal(r.code, 7);
  assert.equal(r.stderr, 'fatal: bad\n');
  assert.equal(r.raw, '');
});

test('probeAgentStats：非零退出但 stdout 有内容时，原文与解析照常返回', async () => {
  const r = await probeAgentStats({
    cmd: 'opencode', env: { PATH: '' },
    execFileFn: (bin, args, opts, cb) => { cb(Object.assign(new Error('partial'), { code: 1 }), SAMPLE, 'warn\n'); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.raw, SAMPLE);
  assert.equal(r.parsed.messages, 3986);
});

test('resolveAgentBin：nga 与 opencode 等价，DEVFLOW_OPENCODE 覆盖对二者都生效', () => {
  const bin = path.join('C:', 'tools', 'opencode.exe');
  const env = { PATH: '', DEVFLOW_OPENCODE: bin };
  assert.equal(resolveAgentBin('opencode', { env, exists: (p) => p === bin, appRoot: '' }), bin);
  assert.equal(resolveAgentBin('nga', { env, exists: (p) => p === bin, appRoot: '' }), bin);
  // 真正无关的命令不吃这个覆盖
  assert.equal(resolveAgentBin('claudecode', { env, exists: (p) => p === bin, appRoot: '' }), 'claudecode');
});

test('resolveAgentBin：nga 与 opencode 互为回退（PATH 上只有另一个时命中它）', () => {
  const dir = path.join('C:', 'bin');
  const nga = path.join(dir, 'nga.exe');
  const oc = path.join(dir, 'opencode.exe');
  assert.equal(resolveAgentBin('opencode', { env: { PATH: dir }, exists: (p) => p === nga, appRoot: '' }), nga);
  assert.equal(resolveAgentBin('nga', { env: { PATH: dir }, exists: (p) => p === oc, appRoot: '' }), oc);
});

test('resolveAgentBin：nga 在 PATH 缺失时命中包内 opencode/', () => {
  const appRoot = path.join('D:', 'pkg');
  const bundled = path.join(appRoot, 'opencode', 'opencode.exe');
  assert.equal(resolveAgentBin('nga', { env: { PATH: '' }, exists: (p) => p === bundled, appRoot }), bundled);
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

test('collectAgentStats：statsFile 落盘采集原文并回读，返回 cwd 与文件 mtime', async () => {
  const statsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-stats-')), 'cache', 'collaboration', 'stats.txt');
  const r = await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {}, resolveCwd: () => '/git/root',
    statsFile,
    execFileFn: (bin, args, opts, cb) => { cb(null, SAMPLE, ''); },
  });
  assert.equal(r.sessions, 21);
  assert.equal(r.cwd, '/git/root');
  assert.ok(r.statsFileMtime > 0);
  assert.equal(fs.readFileSync(statsFile, 'utf8'), SAMPLE);
});

test('collectAgentStats：失败无输出时回读上次 statsFile 内容并带 error 与 mtime', async () => {
  const statsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-stats-')), 'cache', 'collaboration', 'stats.txt');
  fs.mkdirSync(path.dirname(statsFile), { recursive: true });
  fs.writeFileSync(statsFile, SAMPLE, 'utf8');
  const r = await collectAgentStats({
    cmd: 'opencode', env: { PATH: '' }, sleepFn: async () => {}, resolveCwd: () => '/git/root',
    statsFile,
    execFileFn: (bin, args, opts, cb) => { cb(Object.assign(new Error('boom'), { code: 1 }), '', ''); },
  });
  assert.ok(r.error);
  assert.equal(r.raw, SAMPLE);
  assert.equal(r.cwd, '/git/root');
  assert.ok(r.statsFileMtime > 0);
});

test('probeAgentStats：statsFile 落盘并返回 cwd 与文件 mtime', async () => {
  const statsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-stats-')), 'cache', 'collaboration', 'stats.txt');
  const r = await probeAgentStats({
    cmd: 'opencode', env: { PATH: '' }, resolveCwd: () => '/git/root',
    statsFile,
    execFileFn: (bin, args, opts, cb) => { cb(null, SAMPLE, ''); },
  });
  assert.equal(r.ok, true);
  assert.equal(r.parsed.sessions, 21);
  assert.equal(r.cwd, '/git/root');
  assert.ok(r.statsFileMtime > 0);
  assert.equal(fs.readFileSync(statsFile, 'utf8'), SAMPLE);
});
