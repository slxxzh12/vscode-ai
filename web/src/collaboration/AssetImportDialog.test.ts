// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import AssetImportDialog from './AssetImportDialog.vue';

const MANIFEST = {
  format: 'devflow-assets', version: 1, type: 'mixed', exportedAt: 1700000000000,
  source: { machineId: 'm1', host: '127.0.0.1', port: 22222, employeeId: 'e1' },
  kinds: ['skills', 'workflow'],
  skills: [{ name: 'foo', files: 1, hash: 'h' }], command: [], agent: [],
  workflow: [{ id: 'w1', label: 'W1', stages: 2 }],
};

function mockCollab() {
  return {
    importAsset: vi.fn(async () => ({ id: 'imp1', manifest: MANIFEST, summary: {} })),
    applyImport: vi.fn(async () => ({ counts: { skills: 1, command: 0, agent: 0, workflow: 1 } })),
    discardImport: vi.fn(async () => ({ code: 'ok' })),
  };
}
async function pickFile(w: any) {
  const input = w.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.zip')], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

describe('AssetImportDialog', () => {
  it('open=false 不渲染', () => {
    const w = mountC(AssetImportDialog, { props: { open: false, collab: mockCollab() as any } });
    expect(w.find('.mask').exists()).toBe(false);
  });

  it('选文件 → 预览 Manifest → 确认导入', async () => {
    const collab = mockCollab();
    const w = mountC(AssetImportDialog, { props: { open: true, collab: collab as any } });
    await pickFile(w);
    expect(collab.importAsset).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('foo');
    expect(w.text()).toContain('W1');
    await w.find('.confirm').trigger('click');
    await flushPromises();
    expect(collab.applyImport).toHaveBeenCalledWith('imp1');
    expect(w.text()).toContain('Imported');
  });

  it('关闭时丢弃暂存并 emit close', async () => {
    const collab = mockCollab();
    const w = mountC(AssetImportDialog, { props: { open: true, collab: collab as any } });
    await pickFile(w);
    await w.find('.close').trigger('click');
    await flushPromises();
    expect(collab.discardImport).toHaveBeenCalledWith('imp1');
    expect(w.emitted('close')).toHaveLength(1);
  });
});
