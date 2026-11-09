export type MarkdownLocale = 'zh-CN' | 'en';

export interface MarkdownMessages {
  'markdown.mermaid_error': string;
  'markdown.data_error': string;
  'table.confirm': string;
  'flowchart.edit.title': string;
  'flowchart.edit.save': string;
  'flowchart.edit.cancel': string;
  'flowchart.edit.add_node': string;
  'flowchart.edit.add_edge': string;
  'flowchart.edit.add_group': string;
  'flowchart.edit.del': string;
  'flowchart.edit.layout': string;
  'flowchart.edit.reconnect_source': string;
  'flowchart.edit.reconnect_target': string;
  'flowchart.edit.hint': string;
  'ppt.open': string;
  'ppt.close': string;
  'ppt.prev': string;
  'ppt.next': string;
  'ppt.hide_nav': string;
  'ppt.export': string;
  'ppt.exporting': string;
  'ppt.export_failed': string;
}

export const ZH_CN: MarkdownMessages = {
  'markdown.mermaid_error': 'Mermaid 渲染失败：{msg}',
  'markdown.data_error': '数据脚本执行失败：{msg}',
  'table.confirm': '确定',
  'flowchart.edit.title': '编辑流程图',
  'flowchart.edit.save': '保存',
  'flowchart.edit.cancel': '取消',
  'flowchart.edit.add_node': '添加节点',
  'flowchart.edit.add_edge': '添加连线',
  'flowchart.edit.add_group': '添加子图',
  'flowchart.edit.del': '删除',
  'flowchart.edit.layout': '自动布局',
  'flowchart.edit.reconnect_source': '重连起点',
  'flowchart.edit.reconnect_target': '重连终点',
  'flowchart.edit.hint': '双击节点/连线改标签；把节点拖进子图即可分组。',
  'ppt.open': 'PPT 模式',
  'ppt.close': '退出 PPT',
  'ppt.prev': '上一页',
  'ppt.next': '下一页',
  'ppt.hide_nav': '隐藏翻页',
  'ppt.export': '导出 PPT',
  'ppt.exporting': '导出中 {done} / {total}',
  'ppt.export_failed': '导出 PPT 失败：{msg}',
};

export const EN: MarkdownMessages = {
  'markdown.mermaid_error': 'Mermaid render failed: {msg}',
  'markdown.data_error': 'Data script failed: {msg}',
  'table.confirm': 'OK',
  'flowchart.edit.title': 'Edit flowchart',
  'flowchart.edit.save': 'Save',
  'flowchart.edit.cancel': 'Cancel',
  'flowchart.edit.add_node': 'Add node',
  'flowchart.edit.add_edge': 'Add edge',
  'flowchart.edit.add_group': 'Add group',
  'flowchart.edit.del': 'Delete',
  'flowchart.edit.layout': 'Auto layout',
  'flowchart.edit.reconnect_source': 'Reconnect source',
  'flowchart.edit.reconnect_target': 'Reconnect target',
  'flowchart.edit.hint': 'Double-click a node/edge to edit its label; drag a node into a group to embed it.',
  'ppt.open': 'PPT mode',
  'ppt.close': 'Exit PPT',
  'ppt.prev': 'Previous',
  'ppt.next': 'Next',
  'ppt.hide_nav': 'Hide pager',
  'ppt.export': 'Export PPT',
  'ppt.exporting': 'Exporting {done} / {total}',
  'ppt.export_failed': 'PPT export failed: {msg}',
};

export const DEFAULT_MESSAGES: Record<MarkdownLocale, MarkdownMessages> = {
  'zh-CN': ZH_CN,
  en: EN,
};
