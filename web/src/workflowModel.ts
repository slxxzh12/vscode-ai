export interface WorkflowStage {
  id: string;
  label: string;
  group?: string;
  prompts: string[];
}
export interface Workflow {
  id: string;
  label: string;
  stages: WorkflowStage[];
}
export interface ModelIssue {
  path: string;
  key: string;
  params?: Record<string, unknown>;
}
export interface GroupBand {
  name: string;
  startIndex: number;
  stages: WorkflowStage[];
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function newWorkflow(label: string): Workflow {
  return { id: uid('wf'), label, stages: [] };
}

export function newStage(label: string): WorkflowStage {
  return { id: uid('st'), label, group: '', prompts: [''] };
}

export function validateModel(model: Workflow[]): { errors: ModelIssue[]; warnings: ModelIssue[] } {
  const errors: ModelIssue[] = [];
  const warnings: ModelIssue[] = [];
  const wfIds = new Set<string>();
  (model || []).forEach((w, wi) => {
    const wp = `workflow[${wi}]`;
    const id = (w.id || '').trim();
    if (!id) errors.push({ path: wp, key: 'wfe.err.empty_id' });
    else if (wfIds.has(id)) errors.push({ path: wp, key: 'wfe.err.dup_id', params: { id } });
    else wfIds.add(id);
    if (!(w.label || '').trim()) warnings.push({ path: wp, key: 'wfe.warn.empty_label' });
    const stIds = new Set<string>();
    (w.stages || []).forEach((st, si) => {
      const sp = `${wp}.stage[${si}]`;
      const sid = (st.id || '').trim();
      if (!sid) errors.push({ path: sp, key: 'wfe.err.empty_id' });
      else if (stIds.has(sid)) errors.push({ path: sp, key: 'wfe.err.dup_id', params: { id: sid } });
      else stIds.add(sid);
      if (!(st.prompts || []).some((p) => String(p).trim() !== '')) warnings.push({ path: sp, key: 'wfe.warn.empty_prompts' });
    });
  });
  return { errors, warnings };
}

export function groupBands(stages: WorkflowStage[]): GroupBand[] {
  const out: GroupBand[] = [];
  (stages || []).forEach((st, i) => {
    const name = (st.group || '').trim();
    const last = out[out.length - 1];
    if (!last || last.name !== name) out.push({ name, startIndex: i, stages: [st] });
    else last.stages.push(st);
  });
  return out;
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return arr.slice();
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  const idx = Math.max(0, Math.min(next.length, to));
  next.splice(idx, 0, x);
  return next;
}

export function moveStageToIndex(stages: WorkflowStage[], from: number, finalIndex: number, group?: string): WorkflowStage[] {
  if (from < 0 || from >= stages.length) return stages.slice();
  const next = stages.slice();
  const [x] = next.splice(from, 1);
  const moved = group === undefined ? x : { ...x, group };
  const idx = Math.max(0, Math.min(next.length, finalIndex));
  next.splice(idx, 0, moved);
  return next;
}

export function duplicateStage(s: WorkflowStage): WorkflowStage {
  return { id: uid('st'), label: s.label, group: s.group || '', prompts: (s.prompts || []).slice() };
}

export function duplicateWorkflow(w: Workflow, suffix = ''): Workflow {
  const tail = suffix ? ` ${suffix}` : '';
  return { id: uid('wf'), label: `${w.label}${tail}`, stages: (w.stages || []).map(duplicateStage) };
}

export function sanitizeModel(model: Workflow[]): Workflow[] {
  return (model || []).map((w) => ({
    id: w.id,
    label: w.label,
    stages: (w.stages || []).map((st) => ({
      id: st.id,
      label: st.label,
      group: st.group || '',
      prompts: (st.prompts || []).map((p) => String(p)).filter((p) => p.trim() !== ''),
    })),
  }));
}
