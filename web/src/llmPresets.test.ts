import { describe, it, expect } from 'vitest';
import { stateFromConfig, buildSelections, modelOptions } from './llmPresets';

describe('llmPresets helpers', () => {
  it('stateFromConfig 标记 hasKey、勾选预设模型、非预设进 manual', () => {
    const states = stateFromConfig({
      provider: {
        deepseek: { options: { apiKey: 'K' }, models: { 'deepseek-v4-flash': {}, 'my-extra': {} } },
      },
    });
    const ds = states.find((s) => s.id === 'deepseek')!;
    expect(ds.hasKey).toBe(true);
    expect(ds.apiKey).toBe('');
    expect(ds.selected).toEqual(['deepseek-v4-flash']);
    expect(ds.manual).toBe('my-extra');
    const glm = states.find((s) => s.id === 'glm')!;
    expect(glm.hasKey).toBe(false);
    expect(glm.selected).toEqual([]);
    expect(glm.manual).toBe('');
  });

  it('buildSelections 合并勾选与手填、去重去空、无 key 无模型则跳过', () => {
    const states = stateFromConfig({ provider: {} });
    const ds = states.find((s) => s.id === 'deepseek')!;
    ds.apiKey = 'NEW';
    ds.selected = ['deepseek-v4-flash'];
    ds.manual = 'my-extra, , deepseek-v4-flash';
    const sel = buildSelections(states);
    expect(sel).toEqual([{ id: 'deepseek', apiKey: 'NEW', models: ['deepseek-v4-flash', 'my-extra'] }]);
  });

  it('modelOptions 汇总已选 provider/model', () => {
    const states = stateFromConfig({ provider: {} });
    states.find((s) => s.id === 'deepseek')!.selected = ['deepseek-v4-flash'];
    states.find((s) => s.id === 'glm')!.manual = 'glm-4.6';
    expect(modelOptions(states)).toEqual(['deepseek/deepseek-v4-flash', 'glm/glm-4.6']);
  });
});
