// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from './clipboard';

function stubClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('copyText', () => {
  it('空文本返回 false 且不触碰剪贴板', async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    expect(await copyText('')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('有文本时走 navigator.clipboard 并返回 true', async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('clipboard 抛错时回退 execCommand 并返回其结果', async () => {
    stubClipboard(async () => { throw new Error('denied'); });
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    expect(await copyText('x')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });
});
