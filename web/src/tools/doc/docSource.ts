import type { TreeItem } from '@devflow/shared';
import type { FileMeta, FileHashes } from '../../useProjects';

// 文档查看器（DocViewer）的数据源契约：能力（方法）缺省即隐藏对应按钮/面板。
export interface DocReadResult {
  name: string;
  content: string;
  size: number;
  mtime?: number;
  abs?: string;
  binary?: boolean;
}

export interface DocSource {
  kind: 'project' | 'tool';
  read(path: string): Promise<DocReadResult>;
  write(path: string, content: string): Promise<void>;
  rawUrl?(path: string): string;
  list?(dir: string): Promise<TreeItem[]>;
  meta?(path: string): Promise<FileMeta>;
  hash?(path: string): Promise<FileHashes>;
  reveal?(path: string): Promise<void>;
  run?(path: string): Promise<void>;
  pickExternal?(): Promise<DocReadResult | { cancelled: true } | { error: string; message?: string | null }>;
  markdownImageBase?: { projectId: string };
}
