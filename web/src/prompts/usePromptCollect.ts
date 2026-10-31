import { ref, type Ref } from 'vue';
import type { Workflow } from '../workflowModel';
import { t } from '../i18n';
import { appendPromptToWorkflow, collectToMyWorkflow, updatePromptText, MY_WF_ID, MY_STAGE_ID } from './promptCollect';

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
  updatePrompt(target: CollectTarget, index: number, text: string): Promise<CollectStatus>;
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
  async function updatePrompt(target: CollectTarget, index: number, text: string): Promise<CollectStatus> {
    await loadWorkflows();
    const res = updatePromptText(workflows.value, target.workflowId, target.stageId, index, text);
    if (res.status === 'empty') return 'exists';
    if (res.status !== 'ok') return 'no-stage';
    return (await persist(res.list)) ? 'ok' : 'error';
  }
  return { workflows, current, lastTarget, setCurrent, loadWorkflows, collect, updatePrompt };
}

// 仅供测试重置模块级状态；运行时代码不要调用。
export function __resetPromptCollect() {
  workflows.value = [];
  current.value = { workflowId: '', stageId: '' };
  writeTarget(null);
}
