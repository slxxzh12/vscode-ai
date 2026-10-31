// 监听端口的唯一权威源：<应用目录>/data/port.txt（单行纯数字）。
// 应用目录 = server 的上一级（绿色包根 / 仓库根），与启动时的工作目录无关。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.join(__dirname, '..');
export const DATA_DIR = path.join(APP_DIR, 'data');
export const PORT_FILE = path.join(DATA_DIR, 'port.txt');
export const RUNTIME_PORT_FILE = path.join(DATA_DIR, 'runtime-port.txt');
export const DEFAULT_PORT = 22222;

export function validPort(n) {
  const p = Number(n);
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
}

export function readPortFile(file = PORT_FILE) {
  try {
    const text = String(fs.readFileSync(file, 'utf8')).trim();
    if (!/^\d+$/.test(text)) return null;
    return validPort(text);
  } catch { return null; }
}

export function writePortFile(port, file = PORT_FILE) {
  const p = validPort(port);
  if (!p) throw Object.assign(new Error('invalid port'), { code: 'bad-port' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, String(p), 'utf8');
  fs.renameSync(tmp, file);
  return p;
}

// env（DEVFLOW_PORT）> data/port.txt > 默认端口
export function resolvePort({ env = process.env.DEVFLOW_PORT, portFile = PORT_FILE, fallback = DEFAULT_PORT } = {}) {
  return validPort(env) ?? readPortFile(portFile) ?? validPort(fallback) ?? DEFAULT_PORT;
}

// 服务实际监听成功后写，供启动器（launch.ps1 / start.command）打开浏览器
export function writeRuntimePort(port, file = RUNTIME_PORT_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(port), 'utf8');
  } catch { /* ignore */ }
}
