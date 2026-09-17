// 阶段「常用」提示的固定附加项：回答 Agent 的编号/确认菜单时高频用到，
// 无论当前工作流阶段配了什么提示都追加在末尾常驻展示。
export const EXTRA_CHIPS = ['1', '2', '3', '4', '5', 'ok'];

// 合并阶段提示与固定附加项：阶段提示在前、附加项在后；去重（阶段里已配过的不再重复），
// 忽略非字符串与空白项。
export function buildChips(stagePrompts: string[] | undefined | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: unknown) => {
    if (typeof s !== 'string') return;
    const v = s.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const p of Array.isArray(stagePrompts) ? stagePrompts : []) push(p);
  for (const p of EXTRA_CHIPS) push(p);
  return out;
}
