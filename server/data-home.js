import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// 运行时数据统一落在用户数据目录（Windows：%USERPROFILE%\.local\share\devflow；
// Linux/macOS：$XDG_DATA_HOME 或 ~/.local/share 下 /devflow）。
export function dataHome() {
  if (process.env.DEVFLOW_DATA_HOME) return path.resolve(process.env.DEVFLOW_DATA_HOME);
  const base = process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || os.homedir(), '.local', 'share')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'devflow');
}
export function ensureDataHome() {
  const d = dataHome();
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function collabDir() {
  const d = path.join(dataHome(), 'collab');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// 老版本把数据写在仓库 server/ 里；首次启动时若新位置没有、旧文件存在则迁移过去
export function seedFromLegacy(target, legacySource) {
  if (!fs.existsSync(target) && fs.existsSync(legacySource)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(legacySource, target);
  }
}
