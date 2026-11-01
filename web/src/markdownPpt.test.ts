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
