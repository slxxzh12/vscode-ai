// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import WorkflowEditor from './WorkflowEditor.vue';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
afterEach(() => vi.unstubAllGlobals());

describe('WorkflowEditor', () => {
  it('点击遮罩/空白处不关闭，只有右上角 × 才关闭', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ workflows: [] })));
    const w = mountC(WorkflowEditor);
    await flushPromises();
    await w.find('.weoverlay').trigger('click');
    expect(w.emitted('close')).toBeFalsy();
    await w.find('.wex').trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });
});
