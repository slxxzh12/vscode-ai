export type ToolId = 'translate' | 'yaml' | 'notepad' | 'postman' | 'navicat';

export interface MiniToolMeta {
  id: ToolId;
  icon: string;
  labelKey: string;
  descKey: string;
  disabled?: boolean;
  hint?: string;
}

export const MINI_TOOLS: MiniToolMeta[] = [
  { id: 'notepad', icon: '📝', labelKey: 'tools.notepad', descKey: 'tools.desc.notepad' },
  { id: 'postman', icon: '📮', labelKey: 'tools.postman', descKey: 'tools.desc.postman' },
  { id: 'navicat', icon: '🗄️', labelKey: 'tools.navicat', descKey: 'tools.desc.navicat' },
  { id: 'translate', icon: '🌐', labelKey: 'tools.translate', descKey: 'tools.desc.translate' },
  { id: 'yaml', icon: '🧾', labelKey: 'tools.yaml', descKey: 'tools.desc.yaml' },
];
