import { describe, it, expect } from 'vitest';
import {
  apiKeysOf, optionsExtra, modelExtra, parseJsonObject, composeOptions, composeModel,
  rowsFromProvider, providerFromRows, collectModelOptions,
} from './opencodeConfig';

describe('opencodeConfig helpers', () => {
  it('apiKeysOf 兼容 apiKey/apiKeys 并去重去空', () => {
    expect(apiKeysOf({ apiKey: 'K' })).toEqual(['K']);
    expect(apiKeysOf({ apiKeys: ['A', 'B', 'A', ''] })).toEqual(['A', 'B']);
    expect(apiKeysOf(undefined)).toEqual([]);
  });

  it('optionsExtra/modelExtra 去掉受管字段', () => {
    expect(optionsExtra({ baseURL: 'x', apiKey: 'k', headers: { h: '1' } })).toEqual({ headers: { h: '1' } });
    expect(modelExtra({ name: 'N', attachment: true })).toEqual({ attachment: true });
  });

  it('parseJsonObject 只接受对象', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonObject('[1]').ok).toBe(false);
    expect(parseJsonObject('nope').ok).toBe(false);
  });

  it('composeOptions 0/1/N key 形状', () => {
    expect(composeOptions('https://a/v1', [], { headers: { h: '1' } })).toEqual({ headers: { h: '1' }, baseURL: 'https://a/v1' });
    expect(composeOptions('https://a/v1', ['K'])).toEqual({ baseURL: 'https://a/v1', apiKey: 'K' });
    expect(composeOptions('https://a/v1', ['K', 'K2'])).toEqual({ baseURL: 'https://a/v1', apiKeys: ['K', 'K2'] });
  });

  it('composeModel 保留其余字段', () => {
    expect(composeModel('N', { attachment: true })).toEqual({ attachment: true, name: 'N' });
  });

  it('rowsFromProvider/providerFromRows 往返保留未知字段与 key 形状', () => {
    const src = {
      corp: {
        name: 'Corp', extra: 1,
        options: { baseURL: 'https://a/v1', apiKeys: ['A', 'B'], headers: { h: '1' } },
        models: { m1: { name: 'M1', attachment: true } },
      },
    };
    const rows = rowsFromProvider(src);
    expect(rows[0].keys).toEqual(['A', 'B']);
    expect(rows[0].extraOptions).toContain('headers');
    expect(rows[0].models[0].extra).toContain('attachment');

    const back = providerFromRows(rows);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.corp.extra).toBe(1);
      expect((back.value.corp.options as any).apiKeys).toEqual(['A', 'B']);
      expect((back.value.corp.models as any).m1.attachment).toBe(true);
      expect((back.value.corp.models as any).m1.name).toBe('M1');
    }
  });

  it('providerFromRows 拒绝空/重复 ID 与坏 JSON', () => {
    const base = { id: 'a', name: '', baseURL: '', keys: [] as string[], extraOptions: '{}', models: [], rest: {} };
    expect(providerFromRows([{ ...base, id: '' }]).ok).toBe(false);
    expect(providerFromRows([base, { ...base }]).ok).toBe(false);
    expect(providerFromRows([{ ...base, extraOptions: 'nope' }]).ok).toBe(false);
  });

  it('collectModelOptions 排序拼接', () => {
    const rows = rowsFromProvider({ b: { models: { m2: {} } }, a: { models: { m1: {} } } });
    expect(collectModelOptions(rows)).toEqual(['a/m1', 'b/m2']);
  });
});
