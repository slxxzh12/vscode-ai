// 阶段「常用」提示条（chips）的行为规则。
//
// 两类 chip：
// - 阶段提示（来自 config/devflow.xml 的阶段 prompts）：**替换型**，点击把整句填入输入框；
// - 固定附加项 EXTRA_CHIPS：**追加型**，回答 Agent 的编号/确认菜单时高频使用，
//   彼此不互斥，点击按 appendText 的规则追加到输入框末尾。
export const EXTRA_CHIPS = ['1', '2', '3', '4', '5', 'ok'];

export interface Chip {
  text: string;
  append: boolean;   // true = 点击追加；false = 点击替换整段
}

// 追加规则：空文本直接取追加内容；末尾已是空白（含换行）不再补空格；否则用单个空格分隔。
// 追加内容先 trim；追加内容为空白时原样返回。
export function appendText(current: string, add: string): string {
  const s = add.trim();
  if (!s) return current;
  if (!current) return s;
  return /\s$/.test(current) ? current + s : `${current} ${s}`;
}

// 合并阶段提示与固定附加项：阶段提示（替换型）在前、附加项（追加型）在后；
// 按文本去重，阶段提示优先；忽略非字符串与空白项。
export function buildChips(stagePrompts: string[] | undefined | null): Chip[] {
  const out: Chip[] = [];
  const seen = new Set<string>();
  const push = (s: unknown, append: boolean) => {
    if (typeof s !== 'string') return;
    const v = s.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ text: v, append });
  };
  for (const p of Array.isArray(stagePrompts) ? stagePrompts : []) push(p, false);
  for (const p of EXTRA_CHIPS) push(p, true);
  return out;
}
