import fs from 'node:fs';
import path from 'node:path';

// 方案文件夹：US + 6 位编号 - 日期 - 名称；日期兼容 YYYYMMDD 与旧的 YYYY。
export const US_RE = /^US\d{6}-(?:\d{8}|\d{4})-/i;
// 特性文件夹：F + 4 位数字 - 名称，例如 F0001-用户管理；其下可放多个 US 方案。
export const FEATURE_RE = /^F\d{4}-/i;

// 列出方案目录：支持两种布局
//   1) docs/version/US000001-.../
//   2) docs/version/F0001-用户管理/US000001-.../
// 返回相对方案根目录的路径（两级用 / 连接），一级布局返回值与文件夹名一致。
export function listUsDirs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (US_RE.test(e.name)) { out.push(e.name); continue; }
    if (!FEATURE_RE.test(e.name)) continue;
    let children;
    try { children = fs.readdirSync(path.join(dir, e.name), { withFileTypes: true }); } catch { continue; }
    for (const c of children) {
      if (c.isDirectory() && US_RE.test(c.name)) out.push(`${e.name}/${c.name}`);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
