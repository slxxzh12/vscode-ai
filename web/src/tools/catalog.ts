export type ToolId = 'translate' | 'yaml' | 'notepad' | 'postman' | 'navicat' | 'nginx' | 'markdown' | 'js' | 'base64' | 'disk-clean';

export type MiniToolGroup = 'text' | 'data' | 'ops';

export interface MiniToolMeta {
  id: ToolId;
  icon: string;
  labelKey: string;
  descKey: string;
  group: MiniToolGroup;
  disabled?: boolean;
  hint?: string;
}

export const MINI_TOOLS: MiniToolMeta[] = [
  { id: 'notepad', icon: '📝', labelKey: 'tools.notepad', descKey: 'tools.desc.notepad', group: 'text' },
  { id: 'postman', icon: '📮', labelKey: 'tools.postman', descKey: 'tools.desc.postman', group: 'data' },
  { id: 'navicat', icon: '🗄️', labelKey: 'tools.navicat', descKey: 'tools.desc.navicat', group: 'data' },
  { id: 'nginx', icon: '🌉', labelKey: 'tools.nginx', descKey: 'tools.desc.nginx', group: 'data' },
  { id: 'translate', icon: '🌐', labelKey: 'tools.translate', descKey: 'tools.desc.translate', group: 'text' },
  { id: 'yaml', icon: '🧾', labelKey: 'tools.yaml', descKey: 'tools.desc.yaml', group: 'text' },
  { id: 'markdown', icon: '📘', labelKey: 'tools.markdown', descKey: 'tools.desc.markdown', group: 'text' },
  { id: 'js', icon: '🟨', labelKey: 'tools.js', descKey: 'tools.desc.js', group: 'text' },
  { id: 'base64', icon: '🔤', labelKey: 'tools.base64', descKey: 'tools.desc.base64', group: 'text' },
  { id: 'disk-clean', icon: '🧹', labelKey: 'tools.disk-clean', descKey: 'tools.desc.disk-clean', group: 'ops' },
];

export const MINI_TOOL_GROUPS: { id: MiniToolGroup; labelKey: string }[] = [
  { id: 'text', labelKey: 'tools.group.text' },
  { id: 'data', labelKey: 'tools.group.data' },
  { id: 'ops', labelKey: 'tools.group.ops' },
];

// 小工具按分组展示（保留 MINI_TOOLS 的原始顺序）
export function groupMiniTools(list: MiniToolMeta[] = MINI_TOOLS) {
  return MINI_TOOL_GROUPS
    .map((g) => ({ ...g, tools: list.filter((t) => t.group === g.id) }))
    .filter((g) => g.tools.length > 0);
}
