import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOpencodeProviders, resolveApiKey, resolveApiKeys, listProviders, getProvider, buildOpencodeConfig, buildOpencodeConfigMulti, detectEmployeeId } from '../llm-config.js';

function dirWith(obj, name = 'opencode.json') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(d, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
  return d;
}

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fakeJwt(sub) { return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub })}.sig`; }

test('detectEmployeeId 从 opencode 配置的 DevFlow JWT sub 取工号', () => {
  const dir = dirWith({ provider: { 'devflow-corp': { options: { baseURL: 'http://x/api/llm/corp/v1', apiKey: fakeJwt('E10086') } } } });
  assert.equal(detectEmployeeId({ dir, env: {} }), 'E10086');
});

test('detectEmployeeId 环境变量优先，缺配置返回空', () => {
  const dir = dirWith({ provider: { 'devflow-corp': { options: { apiKey: fakeJwt('E1') } } } });
  assert.equal(detectEmployeeId({ dir, env: { DEVFLOW_EMPLOYEE_ID: 'E9' } }), 'E9');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  assert.equal(detectEmployeeId({ dir: empty, env: {} }), '');
});

test('解析 provider 列表与默认 provider', () => {
  const dir = dirWith({
    model: 'corp/gpt-4o',
    provider: { corp: { name: 'Corp', options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { 'gpt-4o': {}, 'gpt-4o-mini': {} } }, openai: { options: { baseURL: 'https://api.openai.com/v1', apiKey: '{env:OPENAI_API_KEY}' } } },
  });
  const { providers, defaultProvider } = loadOpencodeProviders({ dir });
  assert.equal(defaultProvider, 'corp');
  assert.equal(providers.length, 2);
  assert.deepEqual(providers[0].models, ['gpt-4o', 'gpt-4o-mini']);
});

test('未配 baseURL 时用已知 provider 默认值；显式配置优先', () => {
  const dir = dirWith({
    provider: {
      deepseek: { options: { apiKey: 'K' }, models: { 'deepseek-v4-flash': {} } },
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: {} },
    },
  });
  const { providers } = loadOpencodeProviders({ dir });
  const ds = providers.find((p) => p.id === 'deepseek');
  assert.equal(ds.baseURL, 'https://api.deepseek.com/v1');
  const corp = providers.find((p) => p.id === 'corp');
  assert.equal(corp.baseURL, 'https://gw/v1');
});

test('resolveApiKey 支持 {env:}', () => {
  assert.equal(resolveApiKey('{env:FOO}', { FOO: 'bar' }), 'bar');
  assert.equal(resolveApiKey('plain', {}), 'plain');
});

test('listProviders 不泄露 key，只给 hasKey', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'SECRET' } } } });
  const { providers } = listProviders({ dir });
  assert.equal(providers[0].hasKey, true);
  assert.equal(providers[0].apiKey, undefined);
});

test('getProvider 解析出 key', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'S' } } } });
  const p = getProvider('corp', { dir });
  assert.equal(p.apiKey, 'S');
});

test('jsonc 去注释 + 缺文件降级', () => {
  const dir = dirWith('{ // c\n "provider": { "a": { "options": { "baseURL": "https://x/v1" } } } }', 'opencode.jsonc');
  const { providers } = loadOpencodeProviders({ dir });
  assert.equal(providers[0].id, 'a');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  assert.deepEqual(loadOpencodeProviders({ dir: empty }), { providers: [], defaultProvider: null, model: '' });
});

test('loadOpencodeProviders 返回原始 model（供默认模型）', () => {
  const dir = dirWith({ model: 'corp/gpt-4o', provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' } } } });
  const r = loadOpencodeProviders({ dir });
  assert.equal(r.model, 'corp/gpt-4o');
  assert.equal(r.defaultProvider, 'corp');
});

test('buildOpencodeConfig 生成 opencode.json 结构', () => {
  const c = buildOpencodeConfig({ host: '192.168.1.5', port: 22222, providerId: 'corp', baseURL: 'https://gw/v1', token: 'JWT', models: ['gpt-4o'] });
  const p = c.provider['devflow-corp'];
  assert.equal(p.options.baseURL, 'http://192.168.1.5:22222/api/llm/corp/v1');
  assert.equal(p.options.apiKey, 'JWT');
  assert.deepEqual(p.models, { 'gpt-4o': {} });
});

test('resolveApiKeys 解析 {env:} 并去空去重', () => {
  assert.deepEqual(resolveApiKeys(['{env:K1}', 'k2', '', 'k2', 42], { K1: 'x' }), ['x', 'k2']);
  assert.deepEqual(resolveApiKeys([], {}), []);
});

test('getProvider 解析 apiKeys 数组，apiKey 为首个', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKeys: ['A', 'B', 'A'] } } } });
  const p = getProvider('corp', { dir });
  assert.deepEqual(p.apiKeys, ['A', 'B']);
  assert.equal(p.apiKey, 'A');
});

test('无 apiKeys 时回退单个 apiKey', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'S' } } } });
  const p = getProvider('corp', { dir });
  assert.deepEqual(p.apiKeys, ['S']);
  assert.equal(p.apiKey, 'S');
});

test('apiKeys 全空时 hasKey=false、apiKeys 为空', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKeys: ['', '{env:MISSING}'] } } } });
  assert.equal(listProviders({ dir }).providers[0].hasKey, false);
  assert.deepEqual(getProvider('corp', { dir }).apiKeys, []);
});

test('buildOpencodeConfigMulti 生成多个 provider 条目', () => {
  const c = buildOpencodeConfigMulti({
    host: '192.168.1.5', port: 22222, token: 'JWT',
    providers: [
      { id: 'deepseek', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] },
      { id: 'glm', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4', 'glm-4-flash'] },
    ],
  });
  assert.equal(c.provider['devflow-deepseek'].options.apiKey, 'JWT');
  assert.equal(c.provider['devflow-deepseek'].options.baseURL, 'http://192.168.1.5:22222/api/llm/deepseek/v1');
  assert.deepEqual(Object.keys(c.provider['devflow-glm'].models), ['glm-4', 'glm-4-flash']);
  assert.deepEqual(Object.keys(c.provider).sort(), ['devflow-deepseek', 'devflow-glm']);
});
