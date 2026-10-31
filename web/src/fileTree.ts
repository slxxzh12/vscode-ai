// 通用目录树类型：Postman 与记事本共用 web/src/components/FileTree.vue
export type FileTreeActionResult = { ok: boolean; error?: string; path?: string };

export type FileItem = {
  id: string;
  folder: string;
  name: string;
  label?: string;
  updatedAt?: string;
};

export type FileTreeActions = {
  createFolder: (parent: string, name: string) => Promise<FileTreeActionResult>;
  renameFolder: (path: string, name: string) => Promise<FileTreeActionResult>;
  removeFolder: (path: string) => Promise<FileTreeActionResult>;
  renameItem: (id: string, name: string) => Promise<FileTreeActionResult>;
  removeItem: (id: string) => Promise<FileTreeActionResult>;
  moveItem: (id: string, folder: string) => Promise<FileTreeActionResult>;
};
