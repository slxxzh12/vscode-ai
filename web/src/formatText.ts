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
