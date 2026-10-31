import { describe, it, expect } from 'vitest';
import { apiKeysOf } from './opencodeConfig';

describe('opencodeConfig helpers', () => {
  it('apiKeysOf 兼容 apiKey/apiKeys 并去重去空', () => {
    expect(apiKeysOf({ apiKey: 'K' })).toEqual(['K']);
    expect(apiKeysOf({ apiKeys: ['A', 'B', 'A', ''] })).toEqual(['A', 'B']);
    expect(apiKeysOf(undefined)).toEqual([]);
  });
});
