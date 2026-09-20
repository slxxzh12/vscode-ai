import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetById, isVisionModel } from '@devflow/shared/llm-presets';
import { validateSelections, mergeConfiguredProviders } from '../llm-provider-presets.js';

test('presetById 命中四个内置 provider', () => {
  for (const id of ['deepseek', 'glm', 'qwen', 'minimax']) {
    const p = presetById(id);
    assert.ok(p, id);
    assert.equal(p.id, id);
    assert.ok(p.baseURL.startsWith('https://'));
    assert.ok(p.models.length > 0);
  }
  assert.equal(presetById('nope'), null);
});

test('isVisionModel：预设标记与模型名兜底', () => {
  assert.equal(isVisionModel('deepseek', 'deepseek-v4-flash-vision-exp'), true);
  assert.equal(isVisionModel('deepseek', 'deepseek-v4-flash'), false);
  assert.equal(isVisionModel('qwen', 'qwen-vl-max'), true);
  assert.equal(isVisionModel('glm', 'glm-4v-plus'), true);
  assert.equal(isVisionModel('custom', 'my-vl-model'), true);
  assert.equal(isVisionModel('custom', 'plain-text'), false);
});

test('validateSelections 拒绝非法结构、放行自定义（需 baseURL）', () => {
  assert.throws(() => validateSelections('x'), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'nope', models: [] }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'deepseek', models: 'x' }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'deepseek', models: [], apiKey: 1 }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'bad id', baseURL: 'https://x/v1', models: [] }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'nope', baseURL: 'not-a-url', models: [] }]), (e) => e.code === 'bad-config');
  assert.doesNotThrow(() => validateSelections([{ id: 'deepseek', models: ['deepseek-v4-flash'] }]));
  assert.doesNotThrow(() => validateSelections([{ id: 'my-ai', baseURL: 'https://my.ai/v1', models: ['m'] }]));
});

test('mergeConfiguredProviders：预设单 key、vision attachment、保留非预设/附加字段', () => {
  const current = {
    corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {} } },
    deepseek: { options: { baseURL: 'old', apiKeys: ['A', 'B'] }, models: { 'deepseek-v4-flash': { name: 'Legacy' } } },
  };
  const { provider, skipped } = mergeConfiguredProviders({
    current,
    selections: [{ id: 'deepseek', apiKey: 'NEW', models: ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'] }],
  });
  assert.deepEqual(skipped, []);
  assert.deepEqual(Object.keys(provider).sort(), ['corp', 'deepseek']);
  assert.deepEqual(provider.corp, current.corp);
  assert.equal(provider.deepseek.options.baseURL, 'https://api.deepseek.com/v1');
  assert.equal(provider.deepseek.options.apiKey, 'NEW');
  assert.equal('apiKeys' in provider.deepseek.options, false);
  assert.equal(provider.deepseek.name, 'DeepSeek');
  assert.equal(provider.deepseek.models['deepseek-v4-flash'].name, 'Legacy');
  assert.equal(provider.deepseek.models['deepseek-v4-flash-vision-exp'].attachment, true);
  assert.equal('attachment' in provider.deepseek.models['deepseek-v4-flash'], false);
});

test('mergeConfiguredProviders：写入自定义 provider、按 remove 删除', () => {
  const current = {
    dead: { options: { baseURL: 'https://dead/v1', apiKey: 'D' }, models: { x: {} } },
    deepseek: { options: { apiKey: 'OLD' }, models: {} },
  };
  const { provider, skipped } = mergeConfiguredProviders({
    current,
    selections: [
      { id: 'deepseek', apiKey: '', models: ['deepseek-v4-flash'] },
      { id: 'my-ai', name: 'MyAI', baseURL: 'https://my.ai/v1', apiKey: 'MK', models: ['my-model', 'my-vl'] },
    ],
    remove: ['dead'],
  });
  assert.deepEqual(skipped, []);
  assert.deepEqual(Object.keys(provider).sort(), ['deepseek', 'my-ai']);
  assert.equal('dead' in provider, false);
  assert.equal(provider['my-ai'].name, 'MyAI');
  assert.equal(provider['my-ai'].options.baseURL, 'https://my.ai/v1');
  assert.equal(provider['my-ai'].options.apiKey, 'MK');
  assert.equal(provider['my-ai'].models['my-vl'].attachment, true);
  assert.equal(provider.deepseek.options.apiKey, 'OLD');
});

test('mergeConfiguredProviders：留空保留旧 key、无 key 记 skipped', () => {
  const current = { glm: { options: { baseURL: 'x', apiKey: 'OLD' }, models: {} } };
  const a = mergeConfiguredProviders({ current, selections: [{ id: 'glm', apiKey: '', models: ['glm-4.6'] }] });
  assert.equal(a.provider.glm.options.apiKey, 'OLD');
  assert.deepEqual(a.skipped, []);

  const b = mergeConfiguredProviders({ current: {}, selections: [{ id: 'qwen', apiKey: '', models: ['qwen3-max'] }] });
  assert.equal('qwen' in b.provider, false);
  assert.deepEqual(b.skipped, ['qwen']);
});
