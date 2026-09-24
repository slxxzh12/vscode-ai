import type { Workflow } from '../workflowModel';

export type CollectResult =
  | { status: 'ok'; list: Workflow[] }
  | { status: 'exists'; list: Workflow[] }
  | { status: 'no-workflow' }
  | { status: 'no-stage' };

// 把 text 追加到 workflowId.stages[stageId].prompts 末尾。
// - 目标工作流/阶段不存在 → no-workflow / no-stage；
// - text 为空白，或该阶段已含相同 trim 文本 → exists（不改动）；
// - 成功 → ok，返回逐层浅拷贝的新列表（入参不被修改），写入的是未 trim 的原文本。
export function appendPromptToWorkflow(
  list: Workflow[],
  workflowId: string,
  stageId: string,
  text: string,
): CollectResult {
  const wfs = Array.isArray(list) ? list : [];
  const wi = wfs.findIndex((w) => w && w.id === workflowId);
  if (wi < 0) return { status: 'no-workflow' };
  const stages = wfs[wi].stages || [];
  const si = stages.findIndex((s) => s && s.id === stageId);
  if (si < 0) return { status: 'no-stage' };
  const plain = String(text == null ? '' : text);
  const key = plain.trim();
  const prompts = stages[si].prompts || [];
  if (!key || prompts.some((p) => String(p).trim() === key)) {
    return { status: 'exists', list: wfs };
  }
  const nextStages = stages.map((s, i) => (i === si ? { ...s, prompts: [...(s.prompts || []), plain] } : s));
  const next = wfs.map((w, i) => (i === wi ? { ...w, stages: nextStages } : w));
  return { status: 'ok', list: next };
}

export const MY_WF_ID = 'my-prompts';
export const MY_STAGE_ID = 'my-prompts-stage';

export interface MyWorkflowLabels {
  wfId: string;
  wfLabel: string;
  stageId: string;
  stageLabel: string;
}

export interface MyCollectResult {
  status: 'ok' | 'exists';
  list: Workflow[];
  workflowId: string;
  stageId: string;
}

// 取第一个换行前的内容 → trim → 超 max 截断加 '…'；空 / 纯空白 → ''
export function promptAbbr(text: string, max = 40): string {
  const s = String(text == null ? '' : text);
  const nl = s.search(/[\r\n]/);
  const first = (nl >= 0 ? s.slice(0, nl) : s).trim();
  if (first.length <= max) return first;
  return first.slice(0, max) + '…';
}

// 把完整原文收进「我的工作流」：已有同 id 工作流则复用（缺阶段则补阶段），否则新建。
// 空 / 纯空白文本按 exists 处理且不创建工作流；入参不被修改。
export function collectToMyWorkflow(list: Workflow[], text: string, labels: MyWorkflowLabels): MyCollectResult {
  const wfs = Array.isArray(list) ? list : [];
  const plain = String(text == null ? '' : text);
  const key = plain.trim();
  const wi = wfs.findIndex((w) => w && w.id === labels.wfId);
  if (wi >= 0) {
    const stages = wfs[wi].stages || [];
    if (stages.length === 0) {
      if (!key) return { status: 'exists', list: wfs, workflowId: labels.wfId, stageId: labels.stageId };
      const withStage = wfs.map((w, i) => (i === wi
        ? { ...w, stages: [{ id: labels.stageId, label: labels.stageLabel, group: '', prompts: [plain] }] }
        : w));
      return { status: 'ok', list: withStage, workflowId: labels.wfId, stageId: labels.stageId };
    }
    const si = stages.findIndex((s) => s && s.id === labels.stageId);
    const target = si >= 0 ? stages[si] : stages[0];
    const res = appendPromptToWorkflow(wfs, labels.wfId, target.id, plain);
    if (res.status === 'ok') return { status: 'ok', list: res.list, workflowId: labels.wfId, stageId: target.id };
    return { status: 'exists', list: wfs, workflowId: labels.wfId, stageId: target.id };
  }
  if (!key) return { status: 'exists', list: wfs, workflowId: labels.wfId, stageId: labels.stageId };
  const wf: Workflow = {
    id: labels.wfId,
    label: labels.wfLabel,
    stages: [{ id: labels.stageId, label: labels.stageLabel, group: '', prompts: [plain] }],
  };
  return { status: 'ok', list: [wf, ...wfs], workflowId: labels.wfId, stageId: labels.stageId };
}
