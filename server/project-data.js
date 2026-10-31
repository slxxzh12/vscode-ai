import path from 'node:path';
import crypto from 'node:crypto';

// 项目根路径 → 稳定目录键：sha256(根路径) 前 16 位 hex。
// 统计/对话等数据按项目分目录存放，键由根路径决定，避免多窗口多项目互相干扰。
export function projectKey(root) {
  return crypto.createHash('sha256').update(path.resolve(String(root || ''))).digest('hex').slice(0, 16);
}

// 项目数据目录：<portDir>/projects/<sha256(root)>
export function projectDir(portDir, root) {
  return path.join(portDir, 'projects', projectKey(root));
}
