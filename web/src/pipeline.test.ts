import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPipelineConfig, savePipelineConfig, retryPipelineUs } from './pipeline';

function ok(data: unknown) { return { ok: true, text: async () => JSON.stringify(data) } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ok({ autoDev: true, autoMerge: true })));
});

describe('pipeline api', () => {
  it('读取配置', async () => {
    expect(await loadPipelineConfig()).toEqual({ autoDev: true, autoMerge: true });
  });
  it('保存配置', async () => {
    await savePipelineConfig({ autoDev: true });
    expect(fetch).toHaveBeenCalledWith('/api/pipeline/config', expect.objectContaining({ method: 'POST' }));
  });
  it('重试 US', async () => {
    await retryPipelineUs('US000001-2021-A');
    expect(fetch).toHaveBeenCalledWith('/api/pipeline/retry', expect.objectContaining({ method: 'POST' }));
  });
});
