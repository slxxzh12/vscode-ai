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

  it('无工作流 → 自动建「我的工作流」并写入，返回 ok', async () => {
    mockFetch([]);
    const st = await pc.collect('x');
    expect(st).toBe('ok');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
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

  it('addWorkflow：追加一个空工作流并 POST', async () => {
    mockFetch();
    const ok = await pc.addWorkflow();
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows).toHaveLength(3);
    expect(post.body.workflows[2].id).toMatch(/^wf-/);
  });

  it('removeWorkflow：过滤掉整棵子树并 POST', async () => {
    mockFetch();
    const ok = await pc.removeWorkflow('w1');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows.map((w: any) => w.id)).toEqual(['w2']);
  });

  it('removeWorkflow：目标不存在 → false 且不发 POST', async () => {
    mockFetch();
    const ok = await pc.removeWorkflow('nope');
    expect(ok).toBe(false);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('renameWorkflow：改 label 并 POST', async () => {
    mockFetch();
    const ok = await pc.renameWorkflow('w1', 'Renamed');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].label).toBe('Renamed');
    expect(post.body.workflows[0].id).toBe('w1');
  });

  it('addStage：在指定工作流末尾追加新阶段', async () => {
    mockFetch();
    const ok = await pc.addStage('w2');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[1].stages).toHaveLength(1);
    expect(post.body.workflows[1].stages[0].id).toMatch(/^st-/);
  });

  it('removeStage：移除阶段并保留工作流', async () => {
    mockFetch();
    const ok = await pc.removeStage('w1', 's2');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages.map((s: any) => s.id)).toEqual(['s1']);
  });

  it('renameStage：改阶段 label 并 POST', async () => {
    mockFetch();
    const ok = await pc.renameStage('w1', 's1', 'S1x');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].label).toBe('S1x');
  });

  it('addPrompt：在阶段末尾追加空字符串', async () => {
    mockFetch();
    const ok = await pc.addPrompt('w1', 's1');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].prompts).toEqual(['a', '']);
  });

  it('removePrompt：按 index 移除提示词', async () => {
    mockFetch();
    const ok = await pc.removePrompt('w1', 's1', 0);
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].prompts).toEqual([]);
  });

  it('setPrompt：按 index 覆盖文本', async () => {
    mockFetch();
    const ok = await pc.setPrompt('w1', 's1', 0, 'new text');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].prompts).toEqual(['new text']);
  });

  it('POST 失败：返回 false 且不改本地 workflows', async () => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const method = (init && init.method) || 'GET';
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), method, body });
      if (method === 'GET') return { ok: true, json: async () => ({ workflows: wfs() }) };
      return { ok: false, json: async () => ({ error: 'bad' }) };
    }));
    await pc.loadWorkflows();
    const before = JSON.stringify(pc.workflows.value);
    const ok = await pc.renameWorkflow('w1', 'X');
    expect(ok).toBe(false);
    expect(JSON.stringify(pc.workflows.value)).toBe(before);
  });
});
