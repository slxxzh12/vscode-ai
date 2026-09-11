import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStats, parseNum, collectAgentStats } from '../collaboration/agent-stats.js';

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
  const r = await collectAgentStats({ cmd: 'definitely-not-a-cmd-xyz' });
  assert.ok(r.error);
  assert.equal(r.agent, 'definitely-not-a-cmd-xyz');
});
