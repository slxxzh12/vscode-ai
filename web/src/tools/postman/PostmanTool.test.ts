// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanTool from './PostmanTool.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import { usePostmanWorkbench } from './usePostmanWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
function setCmd(w: any, text: string) { w.findAllComponents(CodeEditor)[0].vm.$emit('update:modelValue', text); }
function fieldOf(w: any, i: number) { return w.findAllComponents(CodeEditor)[i].props('modelValue'); }

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); usePostmanWorkbench().msg.value = ''; });

async function runWith(result: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history' ? okJson({ items: [], folders: [] }) : okJson(result))));
  const w = mountC(PostmanTool);
  await flushPromises();
  setCmd(w, 'curl https://a.com');
  await w.find('.pmrun').trigger('click');
  await flushPromises();
  return w;
}

describe('PostmanTool', () => {
  it('执行 curl 显示输出并提示退出码', async () => {
    const w = await runWith({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false });
    expect(fieldOf(w, 2)).toBe('hi');
    expect(w.find('.pmmsg').exists()).toBe(true);
  });

  it('状态码 200 结果框绿色，响应头/体分框', async () => {
    const w = await runWith({ ok: true, code: 0, status: 200, headers: 'HTTP/1.1 200 OK', body: 'hi', stdout: 'hi', stderr: '', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('ok');
    expect(fieldOf(w, 1)).toBe('HTTP/1.1 200 OK');
    expect(fieldOf(w, 2)).toBe('hi');
  });

  it('状态码 500 结果框红色', async () => {
    const w = await runWith({ ok: true, code: 0, status: 500, headers: 'HTTP/1.1 500', body: 'boom', stdout: 'boom', stderr: '', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('err');
  });

  it('连接失败黄色，stderr 单独成框', async () => {
    const w = await runWith({ ok: false, code: 7, status: 0, headers: '', body: '', stdout: '', stderr: 'curl: (7) failed', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('warn');
    expect(fieldOf(w, 3)).toBe('curl: (7) failed');
  });

  it('放大浮层展示内容，关闭后消失', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history'
      ? okJson({ items: [], folders: [] })
      : okJson({ ok: true, code: 0, status: 200, headers: 'HTTP/1.1 200', body: 'BODY-TEXT', stdout: '', stderr: 'ERR-TEXT', timedOut: false }))));
    const w = mountC(PostmanTool, { global: { stubs: { teleport: true } } });
    await flushPromises();
    setCmd(w, 'curl https://a.com');
    await w.find('.pmrun').trigger('click');
    await flushPromises();
    expect(w.find('.pmmodal').exists()).toBe(false);
    await w.findAll('.pmenlarge')[1].trigger('click');
    const editors = w.findAllComponents(CodeEditor);
    expect(editors[editors.length - 1].props('modelValue')).toBe('BODY-TEXT');
    await w.find('.pmclose').trigger('click');
    expect(w.find('.pmmodal').exists()).toBe(false);
  });
});
