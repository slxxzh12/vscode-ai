import { describe, it, expect } from 'vitest';
import { DOC_SLOTS, createDocState, normalizeDocState, selectedDocDirs } from './docUpdate';

describe('docUpdate', () => {
  it('默认状态：代码仓预填项目根并勾选，其它为空且不勾选', () => {
    const s = createDocState('D:\\code');
    expect(DOC_SLOTS).toEqual(['code', 'knowledge', 'solution', 'workflow', 'experience', 'skills', 'rules']);
    expect(s.code).toEqual({ path: 'D:\\code', selected: true });
    expect(s.knowledge).toEqual({ path: '', selected: false });
    expect(s.experience).toEqual({ path: '', selected: false });
    expect(s.skills).toEqual({ path: '', selected: false });
    expect(s.rules).toEqual({ path: '', selected: false });
  });

  it('normalizeDocState：保留已存路径与勾选，非法值回退', () => {
    const s = normalizeDocState({
      code: { path: 'D:\\c', selected: false },
      knowledge: { path: 'D:\\k', selected: true },
      solution: null,
      workflow: { path: 123, selected: 'yes' },
    }, 'D:\\fallback');
    expect(s.code).toEqual({ path: 'D:\\c', selected: false });
    expect(s.knowledge).toEqual({ path: 'D:\\k', selected: true });
    expect(s.solution).toEqual({ path: '', selected: false });
    expect(s.workflow).toEqual({ path: '', selected: false });
    expect(normalizeDocState(null, 'D:\\fallback').code.path).toBe('D:\\fallback');
  });

  it('selectedDocDirs：只取勾选且有路径的目录，去重', () => {
    const s = createDocState('D:\\code');
    s.knowledge = { path: 'D:\\k', selected: true };
    s.solution = { path: 'D:\\k', selected: true };
    s.workflow = { path: 'D:\\w', selected: false };
    expect(selectedDocDirs(s)).toEqual(['D:\\code', 'D:\\k']);
  });
});
