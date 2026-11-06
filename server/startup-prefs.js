import { createJsonStore } from './json-store.js';

// 启动偏好：是否在启动后隐藏服务后台（Windows 绿色包启动器读取）
// 默认隐藏；取消隐藏后 launch.ps1 会以可见控制台直接运行 runtime\node.exe。
export function emptyStartupPrefs() { return { hide: true }; }

export function normalizeStartupPrefs(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return { hide: typeof src.hide === 'boolean' ? src.hide : true };
}

export function createStartupPrefs({ file = null, logger = console } = {}) {
  return createJsonStore({ file, logger, normalize: normalizeStartupPrefs, defaults: emptyStartupPrefs });
}
