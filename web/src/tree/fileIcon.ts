// 按扩展名给文件图标；统一树（TreeView）使用，替代原 TreeNode.vue 的内联实现。
const EXE = new Set(['exe', 'bat', 'cmd', 'ps1']);
const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const ZIP = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
const OFF = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf']);
const CODE: Record<string, string> = {
  html: '🌐', css: '🎨', vue: '🍃', js: '🧩', ts: '🧩', mjs: '🧩', cjs: '🧩', jsx: '🧩', py: '🐍', java: '☕', json: '🧾',
};
const YAML = new Set(['yml', 'yaml']);
const CURL = new Set(['http', 'rest', 'curl']);

export function fileIcon(name: string): string {
  const i = name.lastIndexOf('.');
  const ext = i >= 0 ? name.slice(i + 1).toLowerCase() : '';
  if (CODE[ext]) return CODE[ext];
  if (YAML.has(ext)) return '📐';
  if (CURL.has(ext)) return '⇀';
  if (EXE.has(ext)) return '⬛';
  if (IMG.has(ext)) return '🖼️';
  if (ZIP.has(ext)) return '🗜️';
  if (OFF.has(ext)) return '📝';
  return '📄';
}
