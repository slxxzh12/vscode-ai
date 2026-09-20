import { describe, it, expect } from 'vitest';
import { providersFromConfig, addablePresets, buildProviders, modelOptions, type ConfiguredProvider } from './llmPresets';

describe('llmPresets helpers', () => {
  it('providersFromConfig 回显预设与自定义 provider', () => {
    const list = providersFromConfig({
      provider: {
        deepseek: { options: { apiKey: 'K' }, models: { 'deepseek-v4-flash': {}, 'my-extra': {} } },
        corp: { name: 'Corp', options: { baseURL: 'https://gw/v1', apiKey: 'C' }, models: { a: {}, b: {} } },
      },
    });
    const ds = list.find((s) => s.id === 'deepseek')!;
    expect(ds.custom).toBe(false);
    expect(ds.name).toBe('DeepSeek');
    expect(ds.baseURL).toBe('https://api.deepseek.com/v1');
    expect(ds.hasKey).toBe(true);
    expect(ds.apiKey).toBe('');
    expect(ds.models).toEqual(['deepseek-v4-flash']);
    expect(ds.extraModels).toBe('my-extra');

    const corp = list.find((s) => s.id === 'corp')!;
    expect(corp.custom).toBe(true);
    expect(corp.name).toBe('Corp');
    expect(corp.baseURL).toBe('https://gw/v1');
    expect(corp.models).toEqual([]);
    expect(corp.extraModels).toBe('a, b');
  });

  it('providersFromConfig 空配置返回空数组（不再平铺预设）', () => {
    expect(providersFromConfig({ provider: {} })).toEqual([]);
    expect(providersFromConfig(null)).toEqual([]);
  });

  it('addablePresets 排除已配置', () => {
    const list = providersFromConfig({ provider: { deepseek: {} } });
    const ids = addablePresets(list).map((p) => p.id);
    expect(ids).not.toContain('deepseek');
    expect(ids).toContain('glm');
  });

  it('buildProviders 合并勾选与手填、去重去空', () => {
    const list: ConfiguredProvider[] = [
      { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', custom: false, hasKey: false, apiKey: 'NEW', models: ['deepseek-v4-flash'], extraModels: 'my-extra, , deepseek-v4-flash' },
    ];
    expect(buildProviders(list)).toEqual([
      { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'NEW', models: ['deepseek-v4-flash', 'my-extra'] },
    ]);
  });

  it('modelOptions 汇总 provider/model', () => {
    const list: ConfiguredProvider[] = [
      { id: 'deepseek', name: 'DeepSeek', baseURL: '', custom: false, hasKey: false, apiKey: '', models: ['deepseek-v4-flash'], extraModels: '' },
      { id: 'corp', name: 'Corp', baseURL: '', custom: true, hasKey: false, apiKey: '', models: [], extraModels: 'glm-4.6' },
    ];
    expect(modelOptions(list)).toEqual(['deepseek/deepseek-v4-flash', 'corp/glm-4.6']);
  });
});
