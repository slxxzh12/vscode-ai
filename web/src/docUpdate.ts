export type DocSlot = 'code' | 'knowledge' | 'solution' | 'workflow' | 'experience' | 'skills' | 'rules';

export const DOC_SLOTS: DocSlot[] = ['code', 'knowledge', 'solution', 'workflow', 'experience', 'skills', 'rules'];

export interface DocSlotState { path: string; selected: boolean }
export type DocState = Record<DocSlot, DocSlotState>;

export function createDocState(codeRoot = ''): DocState {
  return {
    code: { path: String(codeRoot || ''), selected: true },
    knowledge: { path: '', selected: false },
    solution: { path: '', selected: false },
    workflow: { path: '', selected: false },
    experience: { path: '', selected: false },
    skills: { path: '', selected: false },
    rules: { path: '', selected: false },
  };
}

// 读取本机保存的 4 个目录与勾选状态；非法项回退为默认（代码仓预填项目根）。
export function normalizeDocState(raw: unknown, codeRoot = ''): DocState {
  const base = createDocState(codeRoot);
  const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  if (!src) return base;
  for (const slot of DOC_SLOTS) {
    const v = src[slot];
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.path === 'string') base[slot].path = o.path;
      if (typeof o.selected === 'boolean') base[slot].selected = o.selected;
    }
  }
  return base;
}

// 提交给后端更新的目录：只取勾选且有路径的项，去重保序。
export function selectedDocDirs(state: DocState): string[] {
  const out: string[] = [];
  for (const slot of DOC_SLOTS) {
    const p = String(state[slot]?.path || '').trim();
    if (state[slot]?.selected && p && !out.includes(p)) out.push(p);
  }
  return out;
}
