// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';

const writeText = vi.fn(async () => {});
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });

afterEach(() => { vi.unstubAllGlobals(); writeText.mockClear(); });

function mount() {
  return mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

describe('MiniTools', () => {
  it('渲染 5 个工具；点击打开全屏面板、点 × 关闭', async () => {
    const w = mount();
    const btns = w.findAll('.mticon');
    expect(btns).toHaveLength(5);
    expect(w.find('.mtbody').exists()).toBe(false);
    await btns[0].trigger('click');
    await flushPromises();
    expect(w.find('.mtbody').exists()).toBe(true);
    expect(w.find('.el-dialog').classes()).toContain('is-fullscreen');
    await w.find('.el-dialog__headerbtn').trigger('click');
    await flushPromises();
    expect((w.find('.el-overlay').element as HTMLElement).style.display).toBe('none');
  });

  it('排序/去重为纯前端计算', async () => {
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    const input = w.findAll('textarea')[0];
    await input.setValue('b\na\nc');
    const btns = w.findAll('.mtbtn');
    expect(btns).toHaveLength(7);
    await btns[0].trigger('click');   // asc
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('a\nb\nc');
    await input.setValue('a\nb\na');
    await btns[6].trigger('click');   // 去重
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('a\nb');
  });

  it('YAML 校验/格式化与错误提示', async () => {
    const w = mount();
    await w.findAll('.mticon')[1].trigger('click');
    await w.findAll('textarea')[0].setValue('a: [1, ');
    await w.findAll('.mtbtn')[0].trigger('click');
    expect(w.find('.mtmsg').exists()).toBe(true);

    await w.findAll('textarea')[0].setValue('b: 2\na: 1');
    await w.findAll('.mtbtn')[1].trigger('click');
    expect(w.find('.mtmsg').text()).toBeTruthy();
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toContain('a: 1');
  });

  it('翻译：空输入提示；成功后写入输出', async () => {
    const w = mount();
    await w.findAll('.mticon')[0].trigger('click');
    await w.find('.mtbtn.primary').trigger('click');
    expect(w.find('.mtmsg').text()).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ text: 'hello' })));
    await w.findAll('textarea')[0].setValue('你好');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('hello');
  });

  it('翻译失败显示错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { message: 'bad input' })));
    const w = mount();
    await w.findAll('.mticon')[0].trigger('click');
    await w.findAll('textarea')[0].setValue('x');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(w.find('.mtmsg').text()).toContain('bad input');
  });

  it('JS 压缩走 /api/format', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return okJson({ content: 'const a=1;' }); }));
    const w = mount();
    await w.findAll('.mticon')[2].trigger('click');
    await w.findAll('textarea')[0].setValue('const a = 1;');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(urls[0]).toBe('/api/format');
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('const a=1;');
  });

  it('Postman：执行 curl 命令并显示输出', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      urls.push(u);
      if (u === '/api/postman/history') return okJson({ items: [] });
      expect(JSON.parse(String(init?.body))).toEqual({ command: 'curl -s https://a.com', folder: '' });
      return okJson({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false });
    }));
    const w = mount();
    await w.findAll('.mticon')[4].trigger('click');
    await flushPromises();
    await w.find('.mtcurl').setValue('curl -s https://a.com');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(urls).toContain('/api/curl');
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('hi');
    expect(w.find('.mtmsg').exists()).toBe(true);
  });

  it('Postman：左侧记录按时间倒序，点击载入，删除移除', async () => {
    const items = [
      { id: 'a.json', command: 'curl old', result: {}, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b.json', command: 'curl new', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' },
    ];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return okJson({ ok: true });
      return okJson({ items });
    }));
    const w = mount();
    await w.findAll('.mticon')[4].trigger('click');
    await flushPromises();
    expect(w.findAll('.mtpmcmd').map((n) => n.text())).toEqual(['curl new', 'curl old']);

    await w.findAll('.mtpmitem')[1].trigger('click');
    expect((w.find('.mtcurl').element as HTMLTextAreaElement).value).toBe('curl old');

    await w.findAll('.mtpmdel')[0].trigger('click');
    await flushPromises();
    expect(w.findAll('.mtpmitem')).toHaveLength(1);
  });

  it('Postman：新建文件夹走 /api/postman/folder', async () => {
    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ url: String(u), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === 'POST') return okJson({ ok: true, folder: 'foo' });
      return okJson({ items: [], folders: [] });
    }));
    const w = mount();
    await w.findAll('.mticon')[4].trigger('click');
    await flushPromises();
    await w.find('.mtpminput').setValue('foo');
    await w.find('.mtpmkfolder .mtmini').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.url === '/api/postman/folder' && c.method === 'POST' && c.body?.path === 'foo')).toBe(true);
  });

  it('Postman：文件夹树展示，记录在目录内按时间倒序', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      folders: ['foo'],
      items: [
        { id: 'foo/a.json', name: 'a.json', command: 'curl A', folder: 'foo', result: {}, updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'foo/b.json', name: 'b.json', command: 'curl B', folder: 'foo', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' },
        { id: 'root.json', name: 'root.json', command: 'curl R', folder: '', result: {}, updatedAt: '2026-05-01T00:00:00.000Z' },
      ],
    })));
    const w = mount();
    await w.findAll('.mticon')[4].trigger('click');
    await flushPromises();
    expect(w.find('.mtpmfname').text()).toContain('foo');
    expect(w.findAll('.mtpmcmd').map((n) => n.text())).toEqual(['curl B', 'curl A', 'curl R']);
  });

  it('复制输出 / 输出转输入 / 清空', async () => {
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    await w.findAll('textarea')[0].setValue('b\na');
    await w.findAll('.mtbtn')[0].trigger('click');   // asc
    const out = () => (w.findAll('textarea')[1].element as HTMLTextAreaElement).value;
    expect(out()).toBe('a\nb');

    const mini = () => w.findAll('.mtmini');
    await mini()[0].trigger('click');   // copy
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('a\nb');

    await mini()[1].trigger('click');   // to input
    expect((w.findAll('textarea')[0].element as HTMLTextAreaElement).value).toBe('a\nb');
    expect(out()).toBe('');

    await mini()[2].trigger('click');   // clear
    expect((w.findAll('textarea')[0].element as HTMLTextAreaElement).value).toBe('');
  });

});
