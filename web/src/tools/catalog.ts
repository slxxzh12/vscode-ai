export type ToolId = 'translate' | 'yaml' | 'notepad' | 'postman' | 'navicat' | 'nginx' | 'markdown' | 'base64';

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
  { id: 'nginx', icon: '🌉', labelKey: 'tools.nginx', descKey: 'tools.desc.nginx' },
  { id: 'translate', icon: '🌐', labelKey: 'tools.translate', descKey: 'tools.desc.translate' },
  { id: 'yaml', icon: '🧾', labelKey: 'tools.yaml', descKey: 'tools.desc.yaml' },
  { id: 'markdown', icon: '📘', labelKey: 'tools.markdown', descKey: 'tools.desc.markdown' },
  { id: 'base64', icon: '🔤', labelKey: 'tools.base64', descKey: 'tools.desc.base64' },
];
