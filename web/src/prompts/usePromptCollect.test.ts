// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePromptCollect, __resetPromptCollect } from './usePromptCollect';

function wfs() {
  return [
    { id: 'w1', label: 'W1', stages: [{ id: 's1', label: 'S1', prompts: ['a'] }, { id: 's2', label: 'S2', prompts: [] }] },
    { id: 'w2', label: 'W2', stages: [] },
  ];
}

let calls: { url: string; method: string; body: any }[];
function mockFetch(initial: any[] = wfs()) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method, body });
    if (method === 'GET') return { ok: true, json: async () => ({ workflows: initial }) };
    return { ok: true, json: async () => ({ workflows: (body && body.workflows) || [] }) };
  }));
}

describe('usePromptCollect', () => {
  const pc = usePromptCollect();
  beforeEach(() => { __resetPromptCollect(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('显式目标：GET 最新 → 追加 → POST，并记录 lastTarget', async () => {
    mockFetch();
    const st = await pc.collect('hello', { workflowId: 'w1', stageId: 's2' });
    expect(st).toBe('ok');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1].body.workflows[0].stages[1].prompts).toContain('hello');
    expect(pc.lastTarget.value).toEqual({ workflowId: 'w1', stageId: 's2' });
  });

  it('重复文本 → exists，且不发 POST', async () => {
    mockFetch();
    const st = await pc.collect('a', { workflowId: 'w1', stageId: 's1' });
    expect(st).toBe('exists');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('无工作流 → no-workflow，且不发 POST', async () => {
    mockFetch([]);
    const st = await pc.collect('x');
    expect(st).toBe('no-workflow');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('setCurrent 后快速追加到当前工作流/阶段', async () => {
    mockFetch();
    pc.setCurrent('w1', 's2');
    const st = await pc.collect('quick');
    expect(st).toBe('ok');
    expect(calls[1].body.workflows[0].stages[1].prompts).toContain('quick');
  });

  it('lastTarget 优先于 current', async () => {
    mockFetch();
    pc.setCurrent('w1', 's2');
    await pc.collect('first', { workflowId: 'w1', stageId: 's1' });   // 记录 lastTarget=w1/s1
    const st = await pc.collect('second');
    expect(st).toBe('ok');
    expect(pc.lastTarget.value).toEqual({ workflowId: 'w1', stageId: 's1' });
    const posted = calls.filter((c) => c.method === 'POST').pop();
    expect(posted?.body.workflows[0].stages[0].prompts).toContain('second');
  });

  it('无可用目标时回退到第一个工作流的第一阶段', async () => {
    mockFetch();
    const st = await pc.collect('fallback');
    expect(st).toBe('ok');
    expect(calls[1].body.workflows[0].stages[0].prompts).toContain('fallback');
  });
});
