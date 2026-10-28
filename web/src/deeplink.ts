// 解析 URL 上的 ?open=<绝对路径>（URLSearchParams 会自动解码一次）。
export function parseOpenParam(search: string): string | null {
  const s = search.startsWith('?') ? search.slice(1) : search;
  const v = new URLSearchParams(s).get('open');
  return v ? v : null;
}

export function parseVoidProject(search: string): string | null {
  const s = search.startsWith('?') ? search.slice(1) : search;
  const v = new URLSearchParams(s).get('voidProject');
  return v ? v : null;
}
