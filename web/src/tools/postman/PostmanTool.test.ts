// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanTool from './PostmanTool.vue';
import CodeEditor from '../../components/CodeEditor.vue';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const REC = (id: string, command: string) => ({ id, command, folder: '', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' });

function setCmd(w: any, text: string) { w.findAllComponents(CodeEditor)[0].vm.$emit('update:modelValue', text); }
function cmdOf(w: any) { return w.findAllComponents(CodeEditor)[0].props('modelValue'); }
function fieldOf(w: any, i: number) { return w.findAllComponents(CodeEditor)[i].props('modelValue'); }

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('PostmanTool', () => {
  it('执行 curl 显示输出并提示退出码', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history'
      ? okJson({ items: [], folders: [] })
      : okJson({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false }))));
    const w = mountC(PostmanTool);
    await flushPromises();
    setCmd(w, 'curl -s https://a.com');
    await w.find('.pmrun').trigger('click');
    await flushPromises();
    expect(fieldOf(w, 2)).toBe('hi');
    expect(w.find('.pmmsg').exists()).toBe(true);
  });

  async function runWith(result: unknown) {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history'
      ? okJson({ items: [], folders: [] })
      : okJson(result))));
    const w = mountC(PostmanTool);
    await flushPromises();
    setCmd(w, 'curl https://a.com');
    await w.find('.pmrun').trigger('click');
    await flushPromises();
    return w;
  }

  it('状态码 200 结果框边框绿色，响应头/体分框', async () => {
    const w = await runWith({ ok: true, code: 0, status: 200, headers: 'HTTP/1.1 200 OK', body: 'hi', stdout: 'hi', stderr: '', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('ok');
    expect(fieldOf(w, 1)).toBe('HTTP/1.1 200 OK');
    expect(fieldOf(w, 2)).toBe('hi');
  });

  it('状态码 500 结果框边框红色', async () => {
    const w = await runWith({ ok: true, code: 0, status: 500, headers: 'HTTP/1.1 500', body: 'boom', stdout: 'boom', stderr: '', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('err');
  });

  it('连接失败结果框边框黄色，stderr 单独成框', async () => {
    const w = await runWith({ ok: false, code: 7, status: 0, headers: '', body: '', stdout: '', stderr: 'curl: (7) failed', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('warn');
    expect(fieldOf(w, 3)).toBe('curl: (7) failed');
  });

  it('新建文件夹后点刷新仍存在', async () => {
    const folders: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history' && (!opt || !opt.method || opt.method === 'GET')) return okJson({ items: [], folders });
      if (u === '/api/postman/folder') { folders.push(JSON.parse(opt.body).path); return okJson({ ok: true }); }
      return okJson({});
    }));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.ftroot .ftnew').trigger('click');
    await w.find('.ftedit').setValue('bar');
    await w.find('.ftedit').trigger('keydown.enter');
    await flushPromises();
    expect(w.text()).toContain('bar');
    await w.find('.pmsidehead .pmmini').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('bar');
  });

  it('文件夹执行：逐条运行并标出通过/未通过', async () => {
    const records = [
      { id: 'foo/a.json', command: 'curl A', folder: 'foo', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'foo/b.json', command: 'curl B', folder: 'foo', result: {}, updatedAt: '2026-09-02T00:00:00.000Z' },
    ];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: records, folders: ['foo'] });
      if (u === '/api/curl') {
        const b = JSON.parse(opt.body);
        calls.push(b.command);
        return okJson({ ok: true, code: 0, status: b.command === 'curl A' ? 200 : 500, headers: '', body: '', stdout: '', stderr: '', timedOut: false });
      }
      return okJson({});
    }));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.ftrow.folder .ftexec').trigger('click');
    await flushPromises();
    expect(calls).toEqual(['curl A', 'curl B']);
    expect(w.findAll('.ftstatus.pass').length).toBe(1);
    expect(w.findAll('.ftstatus.fail').length).toBe(1);
  });

  it('点击记录载入命令', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [REC('a.json', 'curl old')], folders: [] })));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.ftrow.item .ftname').trigger('click');
    expect(cmdOf(w)).toBe('curl old');
  });

  it('点击放大弹出固定浮层展示对应内容，关闭后消失', async () => {
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
    expect(w.find('.pmmodal').exists()).toBe(true);
    expect(editors[editors.length - 1].props('modelValue')).toBe('BODY-TEXT');
    await w.find('.pmclose').trigger('click');
    expect(w.find('.pmmodal').exists()).toBe(false);
  });
});
