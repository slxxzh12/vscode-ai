import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimedAgentSessionIds, findClaimOwner } from '../session-claims.js';

test('claimedAgentSessionIds：排除自身、忽略空值与无 id 记录', () => {
  const rows = [
    { id: 's_a', agentSessionId: 'ses_1' },
    { id: 's_b', agentSessionId: '' },
    { id: 's_c' },
    { id: 's_d', agentSessionId: 'ses_2' },
  ];
  assert.deepEqual([...claimedAgentSessionIds(rows, 's_a')], ['ses_2']);
  assert.deepEqual([...claimedAgentSessionIds(rows)], ['ses_1', 'ses_2']);
  assert.equal(claimedAgentSessionIds(null).size, 0);
});

test('findClaimOwner：只认在跑且账本 id 一致的会话', () => {
  const ledger = [
    { id: 's_a', agentSessionId: 'ses_1' },
    { id: 's_b', agentSessionId: 'ses_1' },
  ];
  const live = [
    { id: 's_a', state: 'exited' },
    { id: 's_b', state: 'running' },
  ];
  assert.equal(findClaimOwner(live, ledger, 'ses_1')?.id, 's_b');
  assert.equal(findClaimOwner(live, ledger, 'ses_1', 's_b'), null);
  assert.equal(findClaimOwner(live, ledger, 'ses_x'), null);
  assert.equal(findClaimOwner(live, ledger, ''), null);
});
