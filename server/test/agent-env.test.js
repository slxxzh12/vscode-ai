import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_ENV, withAgentEnv } from '../agent-env.js';

test('AGENT_ENV 含 OPENCODE_SKIP_SAFE_CHECK=1', () => {
  assert.deepEqual(AGENT_ENV, { OPENCODE_SKIP_SAFE_CHECK: '1' });
});

test('withAgentEnv：并入而不丢原 env，且覆盖同名键', () => {
  const env = { PATH: '/x', OPENCODE_SKIP_SAFE_CHECK: '0' };
  const out = withAgentEnv(env);
  assert.equal(out.PATH, '/x');
  assert.equal(out.OPENCODE_SKIP_SAFE_CHECK, '1');
  assert.equal(env.OPENCODE_SKIP_SAFE_CHECK, '0', '不修改入参');
});
