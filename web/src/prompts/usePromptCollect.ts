import { ref, type Ref } from 'vue';
import { newWorkflow, newStage, type Workflow } from '../workflowModel';
import { t } from '../i18n';
import { appendPromptToWorkflow, collectToMyWorkflow, MY_WF_ID, MY_STAGE_ID } from './promptCollect';

export interface CollectTarget { workflowId: string; stageId: string; }
export type CollectStatus = 'ok' | 'exists' | 'no-stage' | 'error';

const TARGET_KEY = 'devflow-prompt-collect-target';

// 模块级单例：终端上报当前工作流/高亮阶段，历史面板与 chips 共用同一份收藏状态。
const workflows = ref<Workflow[]>([]);
const current = ref<CollectTarget>({ workflowId: '', stageId: '' });
const lastTarget = ref<CollectTarget | null>(readTarget());

function readTarget(): CollectTarget | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(TARGET_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<CollectTarget>;
    if (o && typeof o.workflowId === 'string' && typeof o.stageId === 'string' && o.workflowId && o.stageId) {
      return { workflowId: o.workflowId, stageId: o.stageId };
    }
  } catch { /* ignore */ }
  return null;
}
function writeTarget(t: CollectTarget | null) {
  lastTarget.value = t;
  try {
    if (typeof localStorage === 'undefined') return;
    if (t) localStorage.setItem(TARGET_KEY, JSON.stringify(t));
    else localStorage.removeItem(TARGET_KEY);
  } catch { /* ignore */ }
}

function hasStage(t: CollectTarget): boolean {
  const w = workflows.value.find((x) => x.id === t.workflowId);
  return !!w && (w.stages || []).some((s) => s.id === t.stageId);
}
function resolveTarget(explicit?: CollectTarget): CollectTarget | null {
  if (explicit) return explicit;
  if (lastTarget.value && hasStage(lastTarget.value)) return lastTarget.value;
  if (current.value.workflowId && current.value.stageId && hasStage(current.value)) return current.value;
  const w = workflows.value[0];
  const s = w && (w.stages || [])[0];
  return w && s ? { workflowId: w.id, stageId: s.id } : null;
}

export function usePromptCollect(): {
  workflows: Ref<Workflow[]>;
  current: Ref<CollectTarget>;
  lastTarget: Ref<CollectTarget | null>;
  setCurrent(workflowId: string, stageId: string): void;
  loadWorkflows(): Promise<void>;
  collect(text: string, target?: CollectTarget): Promise<CollectStatus>;
  addWorkflow(): Promise<boolean>;
  removeWorkflow(wfId: string): Promise<boolean>;
  renameWorkflow(wfId: string, label: string): Promise<boolean>;
  addStage(wfId: string): Promise<boolean>;
  removeStage(wfId: string, stageId: string): Promise<boolean>;
  renameStage(wfId: string, stageId: string, label: string): Promise<boolean>;
  addPrompt(wfId: string, stageId: string): Promise<boolean>;
  removePrompt(wfId: string, stageId: string, index: number): Promise<boolean>;
  setPrompt(wfId: string, stageId: string, index: number, text: string): Promise<boolean>;
} {
  function setCurrent(workflowId: string, stageId: string) {
    current.value = { workflowId, stageId };
  }
  async function loadWorkflows() {
    try {
      const r = await fetch('/api/workflows-xml').then((x) => x.json());
      workflows.value = Array.isArray(r && r.workflows) ? r.workflows : [];
    } catch { /* 保留旧缓存 */ }
  }
  async function persist(next: Workflow[]): Promise<boolean> {
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflows: next }),
      });
      if (!r.ok) return false;
      const j: any = await r.json().catch(() => ({}));
      workflows.value = Array.isArray(j && j.workflows) ? j.workflows : next;
      return true;
    } catch { return false; }
  }
  async function collect(text: string, target?: CollectTarget): Promise<CollectStatus> {
    await loadWorkflows();
    const tgt = resolveTarget(target);
    if (!tgt) {
      const labels = {
        wfId: MY_WF_ID,
        wfLabel: t('pc.my_workflow'),
        stageId: MY_STAGE_ID,
        stageLabel: t('pc.my_stage'),
      };
      const res = collectToMyWorkflow(workflows.value, text, labels);
      if (res.status === 'exists') return 'exists';
      if (!(await persist(res.list))) return 'error';
      writeTarget({ workflowId: res.workflowId, stageId: res.stageId });
      return 'ok';
    }
    const res = appendPromptToWorkflow(workflows.value, tgt.workflowId, tgt.stageId, text);
    if (res.status === 'no-workflow' || res.status === 'no-stage') return 'no-stage';
    if (res.status === 'exists') return 'exists';
    if (!(await persist(res.list))) return 'error';
    writeTarget(tgt);
    return 'ok';
  }
  async function addWorkflow(): Promise<boolean> {
    await loadWorkflows();
    return persist([...workflows.value, newWorkflow(t('pc.new_workflow'))]);
  }
  async function removeWorkflow(wfId: string): Promise<boolean> {
    await loadWorkflows();
    if (!workflows.value.some((w) => w.id === wfId)) return false;
    return persist(workflows.value.filter((w) => w.id !== wfId));
  }
  async function renameWorkflow(wfId: string, label: string): Promise<boolean> {
    await loadWorkflows();
    if (!workflows.value.some((w) => w.id === wfId)) return false;
    return persist(workflows.value.map((w) => (w.id === wfId ? { ...w, label } : w)));
  }
  async function addStage(wfId: string): Promise<boolean> {
    await loadWorkflows();
    const wi = workflows.value.findIndex((w) => w.id === wfId);
    if (wi < 0) return false;
    const next = workflows.value.slice();
    next[wi] = { ...next[wi], stages: [...(next[wi].stages || []), newStage(t('pc.new_stage'))] };
    return persist(next);
  }
  async function removeStage(wfId: string, stageId: string): Promise<boolean> {
    await loadWorkflows();
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w || !(w.stages || []).some((s) => s.id === stageId)) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).filter((s) => s.id !== stageId) }
      : x));
    return persist(next);
  }
  async function renameStage(wfId: string, stageId: string, label: string): Promise<boolean> {
    await loadWorkflows();
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w || !(w.stages || []).some((s) => s.id === stageId)) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s) => (s.id === stageId ? { ...s, label } : s)) }
      : x));
    return persist(next);
  }
  async function addPrompt(wfId: string, stageId: string): Promise<boolean> {
    await loadWorkflows();
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w) return false;
    const si = (w.stages || []).findIndex((s) => s.id === stageId);
    if (si < 0) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s, i) => (i === si ? { ...s, prompts: [...(s.prompts || []), ''] } : s)) }
      : x));
    return persist(next);
  }
  async function removePrompt(wfId: string, stageId: string, index: number): Promise<boolean> {
    await loadWorkflows();
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w) return false;
    const si = (w.stages || []).findIndex((s) => s.id === stageId);
    if (si < 0) return false;
    const prompts = (w.stages || [])[si].prompts || [];
    if (index < 0 || index >= prompts.length) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s, i) => (i === si ? { ...s, prompts: prompts.filter((_, pi) => pi !== index) } : s)) }
      : x));
    return persist(next);
  }
  async function setPrompt(wfId: string, stageId: string, index: number, text: string): Promise<boolean> {
    await loadWorkflows();
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w) return false;
    const si = (w.stages || []).findIndex((s) => s.id === stageId);
    if (si < 0) return false;
    const prompts = (w.stages || [])[si].prompts || [];
    if (index < 0 || index >= prompts.length) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s, i) => (i === si ? { ...s, prompts: prompts.map((p, pi) => (pi === index ? text : p)) } : s)) }
      : x));
    return persist(next);
  }
  return { workflows, current, lastTarget, setCurrent, loadWorkflows, collect, addWorkflow, removeWorkflow, renameWorkflow, addStage, removeStage, renameStage, addPrompt, removePrompt, setPrompt };
}

// 仅供测试重置模块级状态；运行时代码不要调用。
export function __resetPromptCollect() {
  workflows.value = [];
  current.value = { workflowId: '', stageId: '' };
  writeTarget(null);
}
