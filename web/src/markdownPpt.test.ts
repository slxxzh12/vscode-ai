// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPptPresenter } from '@devflow/shared/markdown-ppt';

let ppt: ReturnType<typeof createPptPresenter> | null = null;

function make() {
  ppt = createPptPresenter({
    document: window.document,
    mount: document.body,
    showOpenButton: false,
    slideCount: () => 3,
    slideTitle: (i) => `S${i}`,
    renderSlide: (i) => `<p>slide ${i}</p>`,
  });
  return ppt;
}

function press(key: string, opts: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

function count() {
  return (ppt!.element.querySelector('.df-ppt-count') as HTMLElement).textContent;
}

afterEach(() => { ppt?.destroy(); ppt = null; });

describe('PPT 键盘翻页', () => {
  it('左右键/上下键/PageUp/PageDown 均可翻页', async () => {
    make();
    ppt!.open(0);
    await flushPromises();
    expect(count()).toBe('1 / 3');

    press('ArrowRight'); await flushPromises();
    expect(count()).toBe('2 / 3');
    press('ArrowDown'); await flushPromises();
    expect(count()).toBe('3 / 3');
    press('PageDown'); await flushPromises();
    expect(count()).toBe('3 / 3');

    press('ArrowLeft'); await flushPromises();
    expect(count()).toBe('2 / 3');
    press('ArrowUp'); await flushPromises();
    expect(count()).toBe('1 / 3');
    press('PageUp'); await flushPromises();
    expect(count()).toBe('1 / 3');
  });

  it('空格下一页，Shift+空格上一页', async () => {
    make();
    ppt!.open(0);
    await flushPromises();
    press(' '); await flushPromises();
    expect(count()).toBe('2 / 3');
    press(' ', { shiftKey: true }); await flushPromises();
    expect(count()).toBe('1 / 3');
  });

  it('Home/End 跳到首尾页', async () => {
    make();
    ppt!.open(0);
    await flushPromises();
    press('End'); await flushPromises();
    expect(count()).toBe('3 / 3');
    press('Home'); await flushPromises();
    expect(count()).toBe('1 / 3');
  });

  it('点击隐藏翻页后隐藏上下页按钮，键盘仍可翻页', async () => {
    make();
    ppt!.open(0);
    await flushPromises();
    const foot = ppt!.element.querySelector('.df-ppt-foot') as HTMLElement;
    const hide = ppt!.element.querySelector('.df-ppt-hide') as HTMLButtonElement;
    expect(ppt!.element.querySelectorAll('.df-ppt-nav')).toHaveLength(2);
    expect(foot.classList.contains('is-nav-hidden')).toBe(false);

    hide.click();
    await flushPromises();
    expect(foot.classList.contains('is-nav-hidden')).toBe(true);
    press('ArrowRight');
    await flushPromises();
    expect(count()).toBe('2 / 3');

    ppt!.close();
    await flushPromises();
    ppt!.open(0);
    await flushPromises();
    expect(foot.classList.contains('is-nav-hidden')).toBe(false);
  });

  it('输入框内按方向键不翻页', async () => {
    make();
    ppt!.open(0);
    await flushPromises();
    const input = document.createElement('input');
    ppt!.element.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await flushPromises();
    expect(count()).toBe('1 / 3');
  });
});

describe('PPT 导出按钮', () => {
  it('提供 onExport 时渲染导出按钮，并能显示进度', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    ppt = createPptPresenter({
      document: window.document,
      mount: document.body,
      showOpenButton: false,
      slideCount: () => 3,
      slideTitle: (i) => `S${i}`,
      renderSlide: (i) => `<p>slide ${i}</p>`,
      onExport: async (progress) => {
        progress(1, 3);
        await gate;
        progress(3, 3);
      },
      labels: { export: '导出 PPT', exporting: '导出中 {done} / {total}' },
    });
    ppt.open(0);
    await flushPromises();
    const btn = ppt.element.querySelector('.df-ppt-export') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('导出 PPT');

    btn.click();
    await flushPromises();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('导出中 1 / 3');

    press('ArrowRight');
    await flushPromises();
    expect(count()).toBe('1 / 3');

    release();
    await flushPromises();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('导出 PPT');
  });

  it('导出失败时恢复按钮并回调 onExportError', async () => {
    const errors: unknown[] = [];
    ppt = createPptPresenter({
      document: window.document,
      mount: document.body,
      showOpenButton: false,
      slideCount: () => 1,
      slideTitle: () => 'S',
      renderSlide: () => '<p>x</p>',
      onExport: async () => { throw new Error('boom'); },
      onExportError: (e) => errors.push(e),
      labels: { export: '导出 PPT', exporting: '导出中 {done} / {total}' },
    });
    ppt.open(0);
    await flushPromises();
    ppt.element.querySelector<HTMLButtonElement>('.df-ppt-export')!.click();
    await flushPromises();
    expect(errors).toHaveLength(1);
    expect(ppt.element.querySelector<HTMLButtonElement>('.df-ppt-export')!.textContent).toBe('导出 PPT');
  });

  it('暴露 size/index/renderAt/captureEl，renderAt 后仍可正常翻页', async () => {
    make();
    ppt!.open(0);
    await flushPromises();
    expect(ppt!.size()).toBe(3);
    expect(ppt!.index()).toBe(0);
    expect(ppt!.captureEl().classList.contains('df-ppt-main')).toBe(true);

    await ppt!.renderAt(2);
    await flushPromises();
    expect(ppt!.index()).toBe(2);
    expect(count()).toBe('3 / 3');
  });
});
