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

const WFS = [{ id: 'dev', label: 'DEV', stages: [{ id: 's', label: 'S', prompts: ['p'] }] }];
const S1 = { mode: 'interval', interval: { every: 1, unit: 'hour' } };
const TASKS = [{ id: 't1', type: 'workflow', name: 'DEV', schedule: S1, workflow: { workflowId: 'dev', agentId: 'opencode' } }];

function mountStubbed() {
  return mountC(WorkflowEditor, { global: { stubs: { WorkflowFormTab: true, WorkflowXmlTab: true, WorkflowPreviewTab: true } } });
}

function stubFetch(calls: any[], tasks: any[]) {
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    calls.push([String(u), init?.method]);
    if (String(u) === '/api/workflows-xml') return { ok: true, json: async () => ({ workflows: WFS }) };
    if (String(u) === '/api/agents') return { ok: true, json: async () => ({ agents: [{ id: 'opencode', name: 'OpenCode' }] }) };
    if (String(u) === '/api/scheduler/tasks' && (!init || !init.method)) return { ok: true, json: async () => ({ tasks }) };
    if (String(u) === '/api/workflows') return { ok: true, json: async () => ({ workflows: WFS }) };
    return { ok: true, json: async () => ({}) };
  }));
}

describe('WorkflowEditor 定时任务设定', () => {
  it('已有同工作流任务 → 自动勾选；保存走 PUT', async () => {
    const calls: any[] = [];
    stubFetch(calls, TASKS);
    const w = mountStubbed();
    await flushPromises();
    expect((w.find('.wesched input[type=checkbox]').element as HTMLInputElement).checked).toBe(true);
    await w.find('.webtn.primary').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/scheduler/tasks/t1' && m === 'PUT')).toBe(true);
  });

  it('无任务 → 不勾选；勾选并选 Agent 后保存走 POST', async () => {
    const calls: any[] = [];
    stubFetch(calls, []);
    const w = mountStubbed();
    await flushPromises();
    expect((w.find('.wesched input[type=checkbox]').element as HTMLInputElement).checked).toBe(false);
    await w.find('.wesched input[type=checkbox]').setValue(true);
    await w.find('.wesched select:last-of-type').setValue('opencode');
    await w.find('.webtn.primary').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/scheduler/tasks' && m === 'POST')).toBe(true);
  });
});
