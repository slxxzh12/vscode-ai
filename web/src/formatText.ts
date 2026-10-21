// 按文件后缀用 Prettier 格式化文本：FilePreview 与记事本共用。
export const PARSER_BY_EXT: Record<string, string> = {
  js: 'babel', mjs: 'babel', cjs: 'babel', jsx: 'babel',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', css: 'css', html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
};

export function canFormatExt(ext: string): boolean {
  return !!PARSER_BY_EXT[ext];
}

// 内容本身是合法 JSON（对象/数组）时，即使后缀不是 .json 也允许按 JSON 格式化。
export function looksLikeJson(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  const first = s[0];
  const last = s[s.length - 1];
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

// 实际使用的格式化后缀：优先文件后缀，否则在内容为 JSON 时退回 json。
export function formatExtFor(text: string, ext: string): string {
  if (PARSER_BY_EXT[ext]) return ext;
  return looksLikeJson(text) ? 'json' : '';
}

export async function formatText(text: string, ext: string): Promise<string> {
  const parser = PARSER_BY_EXT[ext];
  if (!parser) throw new Error(`unsupported: ${ext}`);
  const [{ default: prettierAny }, babelM, estreeM, tsM, htmlM, postcssM, mdM, yamlM] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/yaml'),
  ]);
  const prettier = (prettierAny as any).default ?? prettierAny;
  const pl = (m: any) => (m.default ?? m);
  const plugins = [pl(babelM), pl(estreeM), pl(tsM), pl(htmlM), pl(postcssM), pl(mdM), pl(yamlM)];
  return prettier.format(text, { parser, plugins });
}
