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
// 流程图编辑器/渲染器按需加载，避免首屏引入 X6
export const FLOW_X6_SCRIPT_NAME = '__devflow_flowx6__.js';
export const FLOW_EDIT_SCRIPT_NAME = '__devflow_flowedit__.js';
// PPT 导出按需加载：截图库与 pptx 生成库
export const HTML_TO_IMAGE_SCRIPT_NAME = '__devflow_html_to_image__.js';
export const PPTXGEN_SCRIPT_NAME = '__devflow_pptxgen__.js';

let cached = null;
let echartsCached = null;
let clientCached = null;
let clientMtime = -1;
let htmlToImageCached = null;
let pptxgenCached = null;

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
  const flow = path.join(sharedDir, 'markdown-flowchart.js');
  const ppt = path.join(sharedDir, 'markdown-ppt.js');
  const pptExport = path.join(sharedDir, 'markdown-ppt-export.js');
  const mtime = Math.max(
    fs.statSync(file).mtimeMs,
    fs.statSync(charts).mtimeMs,
    fs.existsSync(flow) ? fs.statSync(flow).mtimeMs : 0,
    fs.statSync(ppt).mtimeMs,
    fs.statSync(pptExport).mtimeMs,
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

// 按需加载的 X6 流程图栈；首次请求时才编译，之后缓存
let flowX6Cached = null;
export function readFlowX6Script() {
  if (flowX6Cached) return flowX6Cached;
  const require = createRequire(import.meta.url);
  const sharedDir = path.dirname(require.resolve('@devflow/shared'));
  const entry = path.join(sharedDir, 'markdown-flowchart-x6.js');
  const result = buildSync({
    entryPoints: [entry],
    absWorkingDir: sharedDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  flowX6Cached = Buffer.from(result.outputFiles[0].text, 'utf8');
  return flowX6Cached;
}

let flowEditCached = null;
export function readFlowEditScript() {
  if (flowEditCached) return flowEditCached;
  const require = createRequire(import.meta.url);
  const sharedDir = path.dirname(require.resolve('@devflow/shared'));
  const entry = path.join(sharedDir, 'markdown-flowchart-editor.js');
  const result = buildSync({
    entryPoints: [entry],
    absWorkingDir: sharedDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  flowEditCached = Buffer.from(result.outputFiles[0].text, 'utf8');
  return flowEditCached;
}

function packageRoot(moduleName) {
  const require = createRequire(import.meta.url);
  try {
    return path.dirname(require.resolve(`${moduleName}/package.json`));
  } catch {
    let dir = path.dirname(require.resolve(moduleName));
    for (;;) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error(`package root not found: ${moduleName}`);
      dir = parent;
    }
  }
}

function resolveVendorOrModule(vendorName, moduleName, relativePath) {
  const vendor = path.join(HERE, 'vendor', vendorName);
  if (fs.existsSync(vendor)) return vendor;
  return path.join(packageRoot(moduleName), relativePath);
}

// PPT 导出用的截图库（UMD，全局 htmlToImage）
export function readHtmlToImageScript() {
  if (!htmlToImageCached) {
    htmlToImageCached = fs.readFileSync(resolveVendorOrModule('html-to-image.js', 'html-to-image', 'dist/html-to-image.js'));
  }
  return htmlToImageCached;
}

// PPT 导出用的 pptx 生成库（UMD，全局 PptxGenJS）
export function readPptxgenScript() {
  if (!pptxgenCached) {
    pptxgenCached = fs.readFileSync(resolveVendorOrModule('pptxgen.bundle.js', 'pptxgenjs', 'dist/pptxgen.bundle.js'));
  }
  return pptxgenCached;
}
