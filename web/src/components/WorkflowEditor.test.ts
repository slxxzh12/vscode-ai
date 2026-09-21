// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import WorkflowEditor from './WorkflowEditor.vue';

const WFS = [{ id: 'dev', label: 'DEV', stages: [{ id: 's', label: 'S', prompts: ['p'] }] }];
const S1 = { mode: 'interval', interval: { every: 1, unit: 'hour' } };
const TASKS = [{ id: 't1', type: 'workflow', name: 'DEV', schedule: S1, workflow: { workflowId: 'dev', agentId: 'opencode' } }];

function mount() {
  return mountC(WorkflowEditor, { global: { stubs: { WorkflowFormTab: true, WorkflowXmlTab: true, WorkflowPreviewTab: true } } });
}
afterEach(() => vi.unstubAllGlobals());

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
    const w = mount();
    await flushPromises();
    expect((w.find('.wesched input[type=checkbox]').element as HTMLInputElement).checked).toBe(true);
    await w.find('.webtn.primary').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/scheduler/tasks/t1' && m === 'PUT')).toBe(true);
  });

  it('无任务 → 不勾选；勾选并选 Agent 后保存走 POST', async () => {
    const calls: any[] = [];
    stubFetch(calls, []);
    const w = mount();
    await flushPromises();
    expect((w.find('.wesched input[type=checkbox]').element as HTMLInputElement).checked).toBe(false);
    await w.find('.wesched input[type=checkbox]').setValue(true);
    await w.find('.wesched select:last-of-type').setValue('opencode');
    await w.find('.webtn.primary').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/scheduler/tasks' && m === 'POST')).toBe(true);
  });
});
