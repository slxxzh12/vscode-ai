import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { agentSkillsDir, listAgentOptions, resolveSkillRoot } from '../collaboration/agent-skills.js';

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  }
}

test('opencode 映射到 opencode 配置根下的 skills（尊重 DEVFLOW_OPENCODE_CONFIG）', () => {
  withEnv('DEVFLOW_COLLAB_SKILLS', undefined, () => {
    const cfg = path.join(os.tmpdir(), 'df-oc-cfg');
    withEnv('DEVFLOW_OPENCODE_CONFIG', cfg, () => {
      assert.equal(agentSkillsDir({ id: 'opencode', cmd: 'opencode' }), path.join(cfg, 'skills'));
    });
  });
});

test('DEVFLOW_COLLAB_SKILLS 覆盖 opencode skills 根', () => {
  const override = path.join(os.tmpdir(), 'df-collab-skills');
  withEnv('DEVFLOW_COLLAB_SKILLS', override, () => {
    assert.equal(agentSkillsDir({ id: 'opencode', cmd: 'opencode' }), override);
  });
});

test('claudecode 映射到 ~/.claude/skills', () => {
  assert.equal(agentSkillsDir({ id: 'claudecode', cmd: 'claudecode' }), path.join(os.homedir(), '.claude', 'skills'));
});

test('pi 映射到 <PI_CODING_AGENT_DIR>/skills', () => {
  const dir = path.join(os.tmpdir(), 'df-pi-cfg');
  withEnv('PI_CODING_AGENT_DIR', dir, () => {
    assert.equal(agentSkillsDir({ id: 'pi', cmd: 'pi', resume: 'pi' }), path.join(dir, 'skills'));
  });
});

test('未知 agent：有 skillsDir 用配置，没有则 null', () => {
  const dir = path.join(os.tmpdir(), 'nga-skills');
  assert.equal(agentSkillsDir({ id: 'nga', cmd: 'nga.cmd', skillsDir: dir }), path.resolve(dir));
  assert.equal(agentSkillsDir({ id: 'nga', cmd: 'nga.cmd' }), null);
});

test('listAgentOptions 标记 selectable/exists/selected', () => {
  const dir = path.join(os.tmpdir(), 'df-oc-cfg2');
  withEnv('DEVFLOW_OPENCODE_CONFIG', dir, () => {
    withEnv('DEVFLOW_COLLAB_SKILLS', undefined, () => {
      const out = listAgentOptions({
        agents: [
          { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
          { id: 'nga', name: 'nga', cmd: 'nga.cmd' },
        ],
        selected: 'opencode',
      });
      assert.equal(out.length, 2);
      assert.equal(out[0].skillsDir, path.join(dir, 'skills'));
      assert.equal(out[0].selectable, true);
      assert.equal(out[0].exists, false, '目录尚未创建');
      assert.equal(out[0].selected, true);
      assert.equal(out[1].skillsDir, null);
      assert.equal(out[1].selectable, false);
    });
  });
});

test('resolveSkillRoot：agent / custom / 兜底', () => {
  const agents = [{ id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode' }];
  const fallback = path.join(os.tmpdir(), 'fallback-skills');
  assert.equal(resolveSkillRoot({ selected: 'claudecode', agents }), path.join(os.homedir(), '.claude', 'skills'));
  const custom = path.join(os.tmpdir(), 'my-skills');
  assert.equal(resolveSkillRoot({ selected: 'custom', customRoot: custom, agents }), path.resolve(custom));
  assert.equal(resolveSkillRoot({ selected: 'custom', customRoot: '', agents, defaultSkillsRoot: fallback }), fallback);
  assert.equal(resolveSkillRoot({ selected: 'nope', agents, defaultSkillsRoot: fallback }), fallback);
});
