import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResumeCommand, parseSessionList, pickOpencodeSession, discoverAgentSessionId,
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

test('parseSessionList 容错', () => {
  assert.equal(parseSessionList(ITEMS).length, 3);
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
