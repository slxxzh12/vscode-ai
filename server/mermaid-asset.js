import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 静态站点的 Markdown 页面用它按相对路径引用脚本；serveStatic 拦截这些文件名直出
export const MERMAID_SCRIPT_NAME = '__devflow_mermaid__.js';
export const ECHARTS_SCRIPT_NAME = '__devflow_echarts__.js';
// Web / 静态页面共用的增强代码（分组 + ECharts + Mermaid），也由 serveStatic 直出
export const MARKDOWN_CLIENT_SCRIPT_NAME = '__devflow_markdown__.js';

let cached = null;
let echartsCached = null;
let clientCached = null;
let clientMtime = -1;

function resolveMermaidScript() {
  const vendor = path.join(HERE, 'vendor', 'mermaid.min.js');
  if (fs.existsSync(vendor)) return vendor;
  const require = createRequire(import.meta.url);
  return require.resolve('mermaid/dist/mermaid.min.js');
}

export function readMermaidScript() {
  if (!cached) cached = fs.readFileSync(resolveMermaidScript());
  return cached;
}

function resolveEchartsScript() {
  const vendor = path.join(HERE, 'vendor', 'echarts.min.js');
  if (fs.existsSync(vendor)) return vendor;
  const require = createRequire(import.meta.url);
  return require.resolve('echarts/dist/echarts.min.js');
}

export function readEchartsScript() {
  if (!echartsCached) echartsCached = fs.readFileSync(resolveEchartsScript());
  return echartsCached;
}

// 把 shared/markdown-client.js 及其依赖（markdown-charts.js）打成一个浏览器 ESM，
// 这样静态页面只需加载单文件，也不用手工维护多份资源路由。
export function readMarkdownClientScript() {
  const require = createRequire(import.meta.url);
  const sharedDir = path.dirname(require.resolve('@devflow/shared'));
  const file = path.join(sharedDir, 'markdown-client.js');
  const charts = path.join(sharedDir, 'markdown-charts.js');
  const ppt = path.join(sharedDir, 'markdown-ppt.js');
  const mtime = Math.max(
    fs.statSync(file).mtimeMs,
    fs.statSync(charts).mtimeMs,
    fs.statSync(ppt).mtimeMs,
  );
  if (!clientCached || mtime !== clientMtime) {
    const result = buildSync({
      entryPoints: [file],
      absWorkingDir: sharedDir,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      write: false,
      logLevel: 'silent',
    });
    clientMtime = mtime;
    clientCached = Buffer.from(result.outputFiles[0].text, 'utf8');
  }
  return clientCached;
}
