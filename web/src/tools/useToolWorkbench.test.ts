import { describe, it, expect } from 'vitest';
import { useToolWorkbench } from './useToolWorkbench';

describe('useToolWorkbench', () => {
  it('同一 tool 返回同一实例（activeId 共享）', () => {
    const a = useToolWorkbench('notepad');
    const b = useToolWorkbench('notepad');
    expect(a).toBe(b);
    a.activeId.value = 'x.txt';
    expect(b.activeId.value).toBe('x.txt');
    a.activeId.value = '';
  });

  it('不同 tool 相互隔离', () => {
    const a = useToolWorkbench('yaml');
    const b = useToolWorkbench('translate');
    expect(a).not.toBe(b);
    a.activeId.value = 'a.yaml';
    expect(b.activeId.value).toBe('');
    a.activeId.value = '';
  });
});
