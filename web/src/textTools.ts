// 纯文本小工具（排序/去重）：供文件预览与「小工具」面板共用，逻辑与行为保持一致。
export type SortMode = 'asc' | 'desc' | 'asc-ci' | 'desc-ci' | 'num-asc' | 'num-desc';

export const SORT_MODES: SortMode[] = ['asc', 'desc', 'asc-ci', 'desc-ci', 'num-asc', 'num-desc'];

function leadingNumber(s: string): number | null {
  const m = s.trim().match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function numVal(s: string): number {
  const v = leadingNumber(s);
  return v ?? Number.MAX_SAFE_INTEGER;   // 非数字排最后
}

function splitLines(text: string): { lines: string[]; endsNL: boolean } {
  const endsNL = text.endsWith('\n');
  const lines = text.split('\n');
  if (endsNL) lines.pop();
  return { lines, endsNL };
}

export function sortText(text: string, mode: SortMode): string {
  const { lines, endsNL } = splitLines(String(text ?? ''));
  const asc = (a: string, b: string) => { const an = a.toLowerCase(), bn = b.toLowerCase(); return an < bn ? -1 : an > bn ? 1 : 0; };
  const raw = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  switch (mode) {
    case 'asc': lines.sort(raw); break;
    case 'desc': lines.sort((a, b) => raw(b, a)); break;
    case 'asc-ci': lines.sort(asc); break;
    case 'desc-ci': lines.sort((a, b) => asc(b, a)); break;
    case 'num-asc': lines.sort((a, b) => numVal(a) - numVal(b)); break;
    case 'num-desc': lines.sort((a, b) => numVal(b) - numVal(a)); break;
  }
  let out = lines.join('\n');
  if (endsNL) out += '\n';
  return out;
}

// 忽略首尾空白去重，结果按不区分大小写升序
export function dedupText(text: string): string {
  const { lines, endsNL } = splitLines(String(text ?? ''));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  out.sort((a, b) => { const an = a.toLowerCase(), bn = b.toLowerCase(); return an < bn ? -1 : an > bn ? 1 : 0; });
  let res = out.join('\n');
  if (endsNL) res += '\n';
  return res;
}
