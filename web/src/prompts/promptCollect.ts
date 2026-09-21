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
