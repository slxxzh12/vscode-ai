import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildResumeCommand, parseSessionList, pickOpencodeSession, discoverAgentSessionId, isOpencodeAgent,
  isClaudeAgent, pickClaudeSession, discoverClaudeSessionId, claudeProjectSlugs,
  isPiAgent, piSessionDirName, pickPiSession, discoverPiSessionId,
} from '../agent-resume.js';

const ITEMS = JSON.stringify([
  { id: 'ses_a', created: 1000, directory: 'C:\\proj' },
  { id: 'ses_b', created: 5000, directory: 'C:\\proj' },
  { id: 'ses_c', created: 1200, directory: 'C:\\other' },
]);

test('buildResumeCommand：opencode 内建用 --session', () => {
  assert.equal(buildResumeCommand({ agent: { id: 'opencode', cmd: 'opencode' }, agentSessionId: 'ses_x' }), 'opencode --session ses_x');
  assert.equal(buildResumeCommand({ agent: { id: 'opencode', cmd: 'opencode' }, agentSessionId: null }), null);
});

test('buildResumeCommand：配置模板替换 {id}，无 {id} 原样，缺 id 返回 null', () => {
  const agent = { id: 'claudecode', cmd: 'claudecode', resumeCmd: 'claudecode --resume {id}' };
  assert.equal(buildResumeCommand({ agent, agentSessionId: 'abc' }), 'claudecode --resume abc');
  assert.equal(buildResumeCommand({ agent, agentSessionId: null }), null);
  assert.equal(buildResumeCommand({ agent: { id: 'x', cmd: 'x', resumeCmd: 'x --continue' }, agentSessionId: null }), 'x --continue');
});

test('parseSessionList 容错', () => {  assert.equal(parseSessionList(ITEMS).length, 3);
  assert.deepEqual(parseSessionList('nope'), []);
});

test('pickOpencodeSession 按目录 + 时间窗取最接近', () => {
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'c:/proj/', since: 4800 }), 'ses_b');
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'C:\\proj', since: 900 }), 'ses_a');
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'C:\\none', since: 1000 }), null);
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'C:\\proj', since: 999999, now: 999999 }), null);
});

test('discoverAgentSessionId：opencode 走 session list', async () => {
  const calls = [];
  const run = async (cmd, opts) => { calls.push({ cmd, opts }); return ITEMS; };
  const id = await discoverAgentSessionId({ agent: { id: 'opencode', cmd: 'opencode' }, cwd: 'C:\\proj', since: 5000, run });
  assert.equal(id, 'ses_b');
  assert.equal(calls[0].cmd, 'opencode session list --format json -n 30');
});

test('discoverAgentSessionId：resumeDiscover 命令 stdout 去空白', async () => {
  const run = async () => '  sess-123\n';
  const id = await discoverAgentSessionId({ agent: { id: 'claudecode', cmd: 'claudecode', resumeDiscover: 'get-id' }, cwd: 'C:\\proj', since: 0, run });
  assert.equal(id, 'sess-123');
});

test('discoverAgentSessionId：无适配器返回 null；run 失败返回 null', async () => {
  assert.equal(await discoverAgentSessionId({ agent: { id: 'nga', cmd: 'nga.cmd' }, cwd: 'C:\\p', since: 0, run: async () => '' }), null);
  assert.equal(await discoverAgentSessionId({ agent: { id: 'opencode', cmd: 'opencode' }, cwd: 'C:\\p', since: 0, run: async () => null }), null);
});

test('pickOpencodeSession 支持 exclude 跳过已认领 id', () => {
  const items = JSON.parse(ITEMS);
  assert.equal(pickOpencodeSession(items, { cwd: 'C:\\proj', since: 4800, exclude: ['ses_b'] }), 'ses_a');
  assert.equal(pickOpencodeSession(items, { cwd: 'C:\\proj', since: 4800, exclude: new Set(['ses_a', 'ses_b']) }), null);
});

test('discoverAgentSessionId 透传 exclude 给 opencode 发现', async () => {
  const run = async () => ITEMS;
  const id = await discoverAgentSessionId({ agent: { id: 'opencode', cmd: 'opencode' }, cwd: 'C:\\proj', since: 5000, run, exclude: ['ses_b'] });
  assert.equal(id, 'ses_a');
});

test('isOpencodeAgent：resume="opencode" 让改名的 opencode 也走内建适配器', () => {
  assert.equal(isOpencodeAgent({ id: 'nga', cmd: 'nga', resume: 'opencode' }), true);
  assert.equal(isOpencodeAgent({ id: 'opencode', cmd: 'nga' }), true);
  assert.equal(isOpencodeAgent({ id: 'x', cmd: 'C:\\tools\\opencode.exe' }), true);
  assert.equal(isOpencodeAgent({ id: 'nga', cmd: 'nga' }), false);
  assert.equal(isOpencodeAgent(null), false);
});

test('buildResumeCommand：resume="opencode" 时用 agent.cmd 生成续会话命令', () => {
  const agent = { id: 'nga', cmd: 'nga', resume: 'opencode' };
  assert.equal(buildResumeCommand({ agent, agentSessionId: 'ses_x' }), 'nga --session ses_x');
  assert.equal(buildResumeCommand({ agent, agentSessionId: null }), null);
});

test('isClaudeAgent：仅 resume="claude" 启用内建 claude 适配器', () => {
  assert.equal(isClaudeAgent({ id: 'claudecode', cmd: 'claudecode', resume: 'claude' }), true);
  assert.equal(isClaudeAgent({ id: 'codeagent', cmd: 'codeagent', resume: 'claude' }), true);
  assert.equal(isClaudeAgent({ id: 'claudecode', cmd: 'claudecode' }), false);
  assert.equal(isClaudeAgent(null), false);
});

test('buildResumeCommand：resume="claude" 用 --resume <id>', () => {
  const agent = { id: 'claudecode', cmd: 'claudecode', resume: 'claude' };
  assert.equal(buildResumeCommand({ agent, agentSessionId: 'u1' }), 'claudecode --resume u1');
  assert.equal(buildResumeCommand({ agent: { id: 'codeagent', cmd: 'codeagent', resume: 'claude' }, agentSessionId: 'u2' }), 'codeagent --resume u2');
  assert.equal(buildResumeCommand({ agent, agentSessionId: null }), null);
});

test('pickClaudeSession：按时间窗取最接近 since', () => {
  const entries = [{ id: 'a', mtime: 1000 }, { id: 'b', mtime: 5000 }, { id: 'c', mtime: 90000 }];
  assert.equal(pickClaudeSession(entries, { since: 4800 }), 'b');
  assert.equal(pickClaudeSession(entries, { since: 200000, now: 200000 }), null);
});

test('discoverClaudeSessionId：从 ~/.claude/projects/<slug>/*.jsonl 取最接近 since 的会话 id', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'df-claude-'));
  const cwd = 'D:\\proj\\app';
  const dir = path.join(home, '.claude', 'projects', claudeProjectSlugs(cwd)[0]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'u1.jsonl'), '{}');
  fs.writeFileSync(path.join(dir, 'u2.jsonl'), '{}');
  const t1 = 1_000_000, t2 = 2_000_000;
  fs.utimesSync(path.join(dir, 'u1.jsonl'), t1 / 1000, t1 / 1000);
  fs.utimesSync(path.join(dir, 'u2.jsonl'), t2 / 1000, t2 / 1000);
  assert.equal(discoverClaudeSessionId({ cwd, since: 1_900_000, home }), 'u2');
  assert.equal(discoverClaudeSessionId({ cwd: 'D:\\other', since: 1_900_000, home }), null);
});

test('discoverAgentSessionId：resume="claude" 走文件系统发现', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'df-claude2-'));
  const cwd = 'D:\\proj\\app';
  const dir = path.join(home, '.claude', 'projects', claudeProjectSlugs(cwd)[0]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'uuid-9.jsonl'), '{}');
  const id = await discoverAgentSessionId({ agent: { id: 'claudecode', cmd: 'claudecode', resume: 'claude' }, cwd, since: 0, home });
  assert.equal(id, 'uuid-9');
});

test('isPiAgent：resume="pi" 或 id/cmd=pi 命中', () => {
  assert.equal(isPiAgent({ id: 'pi', cmd: 'pi' }), true);
  assert.equal(isPiAgent({ id: 'x', cmd: 'C:\\tools\\pi.exe', resume: 'pi' }), true);
  assert.equal(isPiAgent({ id: 'pi', cmd: 'pi' }), true);
  assert.equal(isPiAgent({ id: 'nga', cmd: 'nga' }), false);
  assert.equal(isPiAgent(null), false);
});

test('buildResumeCommand：pi 用 --session <id>', () => {
  const agent = { id: 'pi', cmd: 'pi', resume: 'pi' };
  assert.equal(buildResumeCommand({ agent, agentSessionId: 'uuid-1' }), 'pi --session uuid-1');
  assert.equal(buildResumeCommand({ agent, agentSessionId: null }), null);
});

test('piSessionDirName：去掉前导分隔符并把 / \\ : 换成 -', () => {
  assert.equal(piSessionDirName('D:\\proj\\app'), '--D--proj-app--');
  assert.equal(piSessionDirName('/path/to/project'), '--path-to-project--');
  assert.equal(piSessionDirName(''), '');
});

test('pickPiSession：按时间窗取最接近 since 并支持 exclude', () => {
  const entries = [{ id: 'a', timestamp: 1000 }, { id: 'b', timestamp: 5000 }, { id: 'c', timestamp: 90000 }];
  assert.equal(pickPiSession(entries, { since: 4800 }), 'b');
  assert.equal(pickPiSession(entries, { since: 4800, exclude: ['b'] }), 'a');
  assert.equal(pickPiSession(entries, { since: 200000, now: 200000 }), null);
});

test('discoverPiSessionId：从 ~/.pi/agent/sessions/<slug>/*.jsonl 取最接近 since 的会话 id', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'df-pi-resume-'));
  const cwd = 'D:\\proj\\app';
  const dir = path.join(home, '.pi', 'agent', 'sessions', piSessionDirName(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const t1 = Date.parse('2024-12-03T14:00:00.000Z');
  const t2 = t1 + 30000;
  fs.writeFileSync(path.join(dir, '1_u1.jsonl'), `${JSON.stringify({ type: 'session', id: 'u1', cwd, timestamp: new Date(t1).toISOString() })}\n`);
  fs.writeFileSync(path.join(dir, '2_u2.jsonl'), `${JSON.stringify({ type: 'session', id: 'u2', cwd, timestamp: new Date(t2).toISOString() })}\n`);
  assert.equal(discoverPiSessionId({ cwd, since: t2 - 1000, home }), 'u2');
  assert.equal(discoverPiSessionId({ cwd, since: t2 - 1000, home, exclude: ['u2'] }), 'u1');
  assert.equal(discoverPiSessionId({ cwd: 'D:\\other', since: t2, home }), null);
});

test('discoverAgentSessionId：resume="pi" 走文件系统发现', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'df-pi-resume2-'));
  const cwd = 'D:\\proj\\app';
  const dir = path.join(home, '.pi', 'agent', 'sessions', piSessionDirName(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_u9.jsonl'), `${JSON.stringify({ type: 'session', id: 'u9', cwd, timestamp: new Date().toISOString() })}\n`);
  const id = await discoverAgentSessionId({ agent: { id: 'pi', cmd: 'pi', resume: 'pi' }, cwd, since: 0, home });
  assert.equal(id, 'u9');
});

test('discoverAgentSessionId：resume="opencode" 时用 agent.cmd 执行 session list', async () => {
  const calls = [];
  const run = async (cmd) => { calls.push(cmd); return ITEMS; };
  const id = await discoverAgentSessionId({ agent: { id: 'nga', cmd: 'nga', resume: 'opencode' }, cwd: 'C:\\proj', since: 5000, run });
  assert.equal(id, 'ses_b');
  assert.equal(calls[0], 'nga session list --format json -n 30');
});
