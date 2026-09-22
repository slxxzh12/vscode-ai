// 统一树的数据源契约：TreeView 只依赖本契约；能力（方法）缺省即隐藏对应菜单/按钮。
export interface TreeSourceNode {
  key: string;                       // 唯一 id：项目=相对路径；工具文件=文件/目录 id；navicat=连接/库/表 key
  name: string;                      // 显示名
  kind: 'dir' | 'item';
  icon?: string;                     // 可选图标；缺省由 TreeView 按 kind/扩展名给默认图标
  time?: string;                     // 可选时间（已格式化字符串）
  status?: 'pass' | 'fail';          // 可选状态点（postman 运行结果）
}

export interface SearchNameHit { path: string; name: string; }
export interface SearchLine { line: number; text: string; }
export type SearchEvent =
  | { type: 'name'; hits: SearchNameHit[] }
  | { type: 'content'; path: string; name: string; lines: SearchLine[] }
  | { type: 'progress'; scanned: number }
  | { type: 'done'; scanned: number };
export interface SearchHit { path: string; name: string; line?: number; query?: string; caseSensitive?: boolean; }

export interface TreeSource {
  loadChildren(dirKey: string): Promise<TreeSourceNode[]>;   // '' = 根
  open(node: TreeSourceNode): void;

  createFile?(dirKey: string, name: string): Promise<void>;
  createFolder?(dirKey: string, name: string): Promise<void>;
  rename?(node: TreeSourceNode, name: string): Promise<void>;
  remove?(node: TreeSourceNode): Promise<void>;
  move?(node: TreeSourceNode, dirKey: string): Promise<void>;
  run?(node: TreeSourceNode): void;
  runFolder?(dirKey: string): void;
  reveal?(node: TreeSourceNode): Promise<void>;
  detail?(node: TreeSourceNode): void;
  copyName?(node: TreeSourceNode): void;
  copyPath?(node: TreeSourceNode): void;
  copyContent?(node: TreeSourceNode): Promise<void>;
  search?(query: string, opts: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean }, signal?: AbortSignal): AsyncIterable<SearchEvent>;
  openHit?(hit: SearchHit): void;
  replaceInFiles?(query: string, opts: { caseSensitive: boolean; all: boolean }, replacement: string): Promise<{ files: number; replacements: number }>;
}

export type { TreeRowNode, TreeRow } from './treeRows';
