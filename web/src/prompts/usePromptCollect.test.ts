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
    if (String(url).includes('/api/workflows-prompt-')) {
      return { ok: true, json: async () => ({ status: 'ok', workflows: initial }) };
    }
    return { ok: true, json: async () => ({ workflows: (body && body.workflows) || [] }) };
  }));
}

describe('usePromptCollect', () => {
  const pc = usePromptCollect();
  beforeEach(() => { __resetPromptCollect(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('显式目标：GET 最新 → 只提交单条提示词到 prompt-add，并记录 lastTarget', async () => {
    mockFetch();
    const st = await pc.collect('hello', { workflowId: 'w1', stageId: 's2' });
    expect(st).toBe('ok');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1].url).toBe('/api/workflows-prompt-add');
    expect(calls[1].body).toMatchObject({ workflowId: 'w1', stageId: 's2', workflowLabel: 'W1', text: 'hello' });
    expect(pc.lastTarget.value).toEqual({ workflowId: 'w1', stageId: 's2' });
  });

  it('重复文本 → exists，且不发 POST', async () => {
    mockFetch();
    const st = await pc.collect('a', { workflowId: 'w1', stageId: 's1' });
    expect(st).toBe('exists');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('无工作流 → 自动建「我的工作流」并写入，返回 ok', async () => {
    mockFetch([]);
    const st = await pc.collect('x');
    expect(st).toBe('ok');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1].url).toBe('/api/workflows');
    const posted = calls[1].body.workflows;
    expect(posted[0].id).toBe('my-prompts');
    expect(posted[0].stages[0].id).toBe('my-prompts-stage');
    expect(posted[0].stages[0].prompts).toEqual(['x']);
    expect(pc.lastTarget.value).toEqual({ workflowId: 'my-prompts', stageId: 'my-prompts-stage' });
  });

  it('无工作流且文本为空白 → exists，不发 POST、不建工作流', async () => {
    mockFetch([]);
    const st = await pc.collect('   ');
    expect(st).toBe('exists');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('setCurrent 后快速追加到当前工作流/阶段，并把 sessionId 带进读写请求', async () => {
    mockFetch();
    pc.setCurrent('w1', 's2', 'sess-1');
    const st = await pc.collect('quick');
    expect(st).toBe('ok');
    expect(calls[0].url).toBe('/api/workflows-xml?sessionId=sess-1');
    expect(calls[1].body).toMatchObject({ sessionId: 'sess-1', workflowId: 'w1', stageId: 's2', text: 'quick' });
  });

  it('lastTarget 优先于 current', async () => {
    mockFetch();
    pc.setCurrent('w1', 's2');
    await pc.collect('first', { workflowId: 'w1', stageId: 's1' });   // 记录 lastTarget=w1/s1
    const st = await pc.collect('second');
    expect(st).toBe('ok');
    expect(pc.lastTarget.value).toEqual({ workflowId: 'w1', stageId: 's1' });
    const posted = calls.filter((c) => c.method === 'POST').pop();
    expect(posted?.body).toMatchObject({ workflowId: 'w1', stageId: 's1', text: 'second' });
  });

  it('updatePrompt：GET 最新 → 提交单条更新到 prompt-update', async () => {
    mockFetch();
    const st = await pc.updatePrompt({ workflowId: 'w1', stageId: 's1' }, 0, 'a2');
    expect(st).toBe('ok');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1].url).toBe('/api/workflows-prompt-update');
    expect(calls[1].body).toMatchObject({ workflowId: 'w1', stageId: 's1', workflowLabel: 'W1', index: 0, text: 'a2' });
  });

  it('updatePrompt：空白文本或越界 → 不发 POST', async () => {
    mockFetch();
    expect(await pc.updatePrompt({ workflowId: 'w1', stageId: 's1' }, 0, '  ')).toBe('exists');
    expect(await pc.updatePrompt({ workflowId: 'w1', stageId: 's1' }, 9, 'x')).toBe('no-stage');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('无可用目标时回退到第一个工作流的第一阶段', async () => {
    mockFetch();
    const st = await pc.collect('fallback');
    expect(st).toBe('ok');
    expect(calls[1].body).toMatchObject({ workflowId: 'w1', stageId: 's1', text: 'fallback' });
  });
});
