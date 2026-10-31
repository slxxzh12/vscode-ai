// 工作流「分组」展开为线性步骤的纯函数（server 与 web 共用）。
// 分组规则与 groupBands 一致：连续同名 group 为一组，未命名（空串）也算一组。

export function promptStepId(stageId, index) {
  return `${stageId}#${index}`;
}

export function groupAnchorStages(stages, anchorStageId) {
  const list = Array.isArray(stages) ? stages : [];
  const at = list.findIndex((s) => s.id === anchorStageId);
  if (at < 0) return null;
  const group = String(list[at].group || '').trim();
  const same = (s) => String(s.group || '').trim() === group;
  let start = at;
  while (start > 0 && same(list[start - 1])) start -= 1;
  let end = at;
  while (end + 1 < list.length && same(list[end + 1])) end += 1;
  return { group, stages: list.slice(start, end + 1) };
}

export function expandGroupSteps(stages, anchorStageId) {
  const band = groupAnchorStages(stages, anchorStageId);
  if (!band) return null;
  const steps = [];
  for (const st of band.stages) {
    const prompts = Array.isArray(st.prompts) ? st.prompts : [];
    prompts.forEach((text, idx) => {
      steps.push({
        id: promptStepId(st.id, idx),
        stageId: st.id,
        index: steps.length,
        text: String(text),
        type: st.type === 'cmd' ? 'cmd' : 'prompt',
      });
    });
  }
  return { group: band.group, steps };
}

// 整条工作流：把全部 stage 的 prompts 拍平成线性步骤（定时运行用）
export function expandAllSteps(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const steps = [];
  for (const st of list) {
    const prompts = Array.isArray(st.prompts) ? st.prompts : [];
    prompts.forEach((text, idx) => {
      steps.push({
        id: promptStepId(st.id, idx),
        stageId: st.id,
        index: steps.length,
        text: String(text),
        type: st.type === 'cmd' ? 'cmd' : 'prompt',
        advance: st.advance === 'manual' ? 'manual' : 'auto',
      });
    });
  }
  return steps;
}
