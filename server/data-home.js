import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 运行时数据统一落在用户数据目录（Windows：%USERPROFILE%\.local\share\void；
// Linux/macOS：$XDG_DATA_HOME 或 ~/.local/share 下 /void）。
export function dataHome() {
  if (process.env.DEVFLOW_DATA_HOME) return path.resolve(process.env.DEVFLOW_DATA_HOME);
  const base = process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || os.homedir(), '.local', 'share')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'void');
}

// 一个端口一份数据：<dataHome>/ports/<端口>
function portRoot(port, root) {
  return path.join(root, 'ports', String(port));
}
// 活动配置目录（<端口>/downloads/devflow.xml）；注意与协作收件目录 downloadDir（单数）区分
export function downloadsDir(port, root = dataHome()) {
  return path.join(portRoot(port, root), 'downloads');
}
// 中转站转换插件目录（<端口>/downloads/relay-plugins）；仅加载其下 *.mjs
export function relayPluginsDir(port, root = dataHome()) {
  return path.join(downloadsDir(port, root), 'relay-plugins');
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
