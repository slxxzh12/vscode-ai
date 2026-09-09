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
// 我发出的文件/技能 zip 落 upload；收到的落 download（下载页/收件箱展示同目录）
export function uploadDir() {
  const d = path.join(dataHome(), 'upload');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function downloadDir() {
  const d = path.join(dataHome(), 'download');
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

// ---- 多实例（同机模拟集群）：DEVFLOW_NODE 指定实例，状态按该实例公钥指纹隔离 ----
// identity 存在 <root>/nodes/<实例名>/identity.json（按名字引导）；其余状态全部落到
// <root>/nodes/<公钥指纹16hex>/ 下，同实例稳定、不同实例/不同密钥天然隔离。
export function instanceName() {
  const n = (process.env.DEVFLOW_NODE || '').trim();
  return n === '' || n === 'default' ? '' : n;
}
export function instanceSeedDir(name) {
  const d = path.join(dataHome(), 'nodes', name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function instanceFpRoot(fp) {
  const d = path.join(dataHome(), 'nodes', fp);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
