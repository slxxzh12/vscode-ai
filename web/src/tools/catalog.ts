export type ToolId = 'translate' | 'yaml' | 'js' | 'sort' | 'postman' | 'navicat';

export interface MiniToolMeta {
  id: ToolId;
  icon: string;
  labelKey: string;
  descKey: string;
  disabled?: boolean;
  hint?: string;
}

export const MINI_TOOLS: MiniToolMeta[] = [
  { id: 'translate', icon: '🌐', labelKey: 'tools.translate', descKey: 'tools.desc.translate' },
  { id: 'yaml', icon: '🧾', labelKey: 'tools.yaml', descKey: 'tools.desc.yaml' },
  { id: 'js', icon: '⚙', labelKey: 'tools.js', descKey: 'tools.desc.js' },
  { id: 'sort', icon: '↕', labelKey: 'tools.sort', descKey: 'tools.desc.sort' },
  { id: 'postman', icon: '📮', labelKey: 'tools.postman', descKey: 'tools.desc.postman' },
  { id: 'navicat', icon: '🗄️', labelKey: 'tools.navicat', descKey: 'tools.desc.navicat' },
];
