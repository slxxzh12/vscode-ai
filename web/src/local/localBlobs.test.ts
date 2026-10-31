import { test, expect, vi, afterEach } from 'vitest';
import { trackBlob, releaseBlob, releaseBlobs, resetBlobs } from './localBlobs';

afterEach(() => { resetBlobs(); vi.unstubAllGlobals(); });

test('trackBlob 返回值；releaseBlobs 回收该作用域全部 URL', () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: (b: unknown) => `blob:${String(b)}`, revokeObjectURL: revoke });
  expect(trackBlob('s1', 'blob:a')).toBe('blob:a');
  trackBlob('s1', 'blob:b');
  trackBlob('s2', 'blob:c');
  releaseBlobs('s1');
  expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:a', 'blob:b']);
  releaseBlobs('s2');
  expect(revoke).toHaveBeenCalledTimes(3);
});

test('releaseBlob 只释放单个', () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: revoke });
  trackBlob('s', 'blob:x');
  releaseBlob('s', 'blob:x');
  expect(revoke).toHaveBeenCalledWith('blob:x');
  releaseBlob('s', 'blob:x');
  expect(revoke).toHaveBeenCalledTimes(1);
});
