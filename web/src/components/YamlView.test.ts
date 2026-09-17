// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountC } from '../test-utils';
import YamlView from './YamlView.vue';

function stubPrompt(v: string | null) {
  Object.defineProperty(window, 'prompt', { value: vi.fn(() => v), configurable: true, writable: true });
}

afterEach(() => vi.unstubAllGlobals());

describe('YamlView', () => {
  it('解析错误显示错误条', () => {
    const w = mountC(YamlView, { props: { text: 'a: [1, ' } });
    expect(w.find('.yverr').exists()).toBe(true);
    expect(w.find('.yvtree').exists()).toBe(false);
  });

  it('合法 YAML 渲染树；标量可编辑并 emit 更新', async () => {
    const w = mountC(YamlView, { props: { text: 'a: 1\nb: 2\n' } });
    expect(w.find('.yverr').exists()).toBe(false);
    expect(w.findAll('.yvrow')).toHaveLength(2);
    const input = w.find('.yvval');
    await input.setValue('9');
    await input.trigger('change');
    const emitted = w.emitted('update:text');
    expect(emitted).toBeTruthy();
    expect(String(emitted?.[0]?.[0])).toContain('a: 9');
  });

  it('折叠/展开子节点', async () => {
    const w = mountC(YamlView, { props: { text: 'root:\n  x: 1\n' } });
    const before = w.findAll('.yvrow').length;
    expect(before).toBeGreaterThan(1);
    await w.findAll('.yvtog')[0].trigger('click');
    expect(w.findAll('.yvrow').length).toBeLessThan(before);
    await w.findAll('.yvtog')[0].trigger('click');
    expect(w.findAll('.yvrow').length).toBe(before);
  });

  it('新增根键：prompt 为空不写入，有值才 emit', async () => {
    stubPrompt(null);
    const w = mountC(YamlView, { props: { text: 'a: 1\n' } });
    await w.find('.yvbar .yvmini').trigger('click');
    expect(w.emitted('update:text')).toBeUndefined();

    stubPrompt('c');
    await w.find('.yvbar .yvmini').trigger('click');
    expect(String(w.emitted('update:text')?.[0]?.[0])).toContain('c:');
  });

  it('序列节点可新增子项与删除', async () => {
    stubPrompt('z');
    const w = mountC(YamlView, { props: { text: 'list:\n  - a\n  - b\n' } });
    const seq = w.findAll('.yvrow').find((r) => r.find('.yvtype').exists() && r.find('.yvtype').text() === '[ ]');
    expect(seq).toBeTruthy();
    const acts = seq!.findAll('.yvacts .yvmini');
    expect(acts).toHaveLength(4);
    await acts[0].trigger('click');   // 新增序列项
    expect(w.emitted('update:text')).toBeTruthy();
    await acts[3].trigger('click');   // 删除
    expect((w.emitted('update:text') as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('map 节点新增子键', async () => {
    stubPrompt('k');
    const w = mountC(YamlView, { props: { text: 'root:\n  x: 1\n' } });
    const row = w.findAll('.yvrow').find((r) => r.find('.yvtype').exists() && r.find('.yvtype').text() === '{ }');
    const add = row!.findAll('.yvacts .yvmini')[0];
    await add.trigger('click');
    expect(String(w.emitted('update:text')?.[0]?.[0])).toContain('k:');
  });

  it('外部 text 变化同步到内部', async () => {
    const w = mountC(YamlView, { props: { text: 'a: 1\n' } });
    await w.setProps({ text: 'a: 2\nb: 3\n' });
    expect(w.findAll('.yvrow')).toHaveLength(2);
    expect((w.find('.yvval').element as HTMLInputElement).value).toBe('2');
  });
});
