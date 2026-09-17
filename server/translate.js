// 英文提示词翻译：读本机 opencode.json/jsonc 的 provider 配置，直连 <baseURL>/chat/completions。
// 不走 `opencode run` CLI（进程/会话开销大，且 CLI 本身可能不可用），因此快很多。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadOpencodeProviders, getProvider as defaultGetProvider } from './llm-config.js';

export const MAX_INPUT_CHARS = 20000;
export const DEFAULT_TIMEOUT_MS = 60000;
export const MODELS_TIMEOUT_MS = 15000;
export const MODELS_TTL_MS = 60000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BODY = 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

// 英文常量：既让 LLM 更稳，也避免 server 代码里出现中文（check:i18n）。
export const SYSTEM_INSTRUCTION = [
  'You are a professional translator for software engineering prompts.',
  'Translate the user message from Chinese into natural, idiomatic English.',
  'Output only the English translation, with no explanation, no quotes and no extra text.',
  'Preserve Markdown structure, line breaks, lists, code blocks, file paths, commands and product names exactly as they are.',
].join('\n');

// 带图时的指令：按用户要求作答，且一律用英文回复（可问答、可翻译图中文字）。
export const IMAGE_INSTRUCTION = [
  'You are a vision assistant for software engineering.',
  'The user message may reference one or more images that are attached to this conversation.',
  'Do what the user asks: answer questions about the images and/or translate the text in them.',
  'Always reply in English only, with no extra explanation beyond what was asked.',
  'Preserve Markdown structure, code blocks, commands, file paths and product names exactly as they are.',
].join('\n');

function fail(code, message = '') {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

export function buildMessages(text, images = []) {
  if (!images.length) {
    return [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: text },
    ];
  }
  const content = [{ type: 'text', text: String(text) }];
  for (const url of images) content.push({ type: 'image_url', image_url: { url } });
  return [
    { role: 'system', content: IMAGE_INSTRUCTION },
    { role: 'user', content },
  ];
}

// 从文本里找出图片路径：优先引号/反引号包裹（含空格也安全），再兜底裸绝对路径
export function extractImagePaths(text) {
  const s = String(text ?? '');
  const out = [];
  const add = (p) => { const v = String(p || '').trim().replace(/^["'`]+|["'`]+$/g, ''); if (IMAGE_EXT.test(v) && !out.includes(v)) out.push(v); };
  const quoted = /["'`]([^"'`\r\n]+)["'`]/g;
  let m;
  while ((m = quoted.exec(s))) add(m[1]);
  const bare = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)[^\s"'`<>|?*\r\n]*/g;
  while ((m = bare.exec(s))) add(m[0].replace(/[),.;:]+$/, ''));
  return out;
}

function withinAnyRoot(abs, roots) {
  if (!roots || !roots.length) return true;
  const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const real = realOf(abs);
  return roots.some((r) => { const rr = realOf(r); return real === rr || real.startsWith(rr + path.sep); });
}

function readImageBytes(absPath, { allowedRoots = null } = {}) {
  const p = path.isAbsolute(absPath) ? absPath : path.resolve(String(absPath ?? ''));
  if (!withinAnyRoot(p, allowedRoots)) throw fail('forbidden');
  const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
  if (!mime) throw fail('bad-image');
  let st;
  try { st = fs.statSync(p); } catch { throw fail('image-missing'); }
  if (!st.isFile()) throw fail('image-missing');
  if (st.size > MAX_IMAGE_BYTES) throw fail('image-too-large');
  let buf;
  try { buf = fs.readFileSync(p); } catch { throw fail('image-missing'); }
  return { buf, mime };
}

function readImageFile(abs) {
  const { buf, mime } = readImageBytes(abs);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 路径数组 → data URL 数组；不存在的/不可读的直接跳过，超量或过大报错
export function resolveImageList(paths, { allowedRoots = null, readImage = readImageFile } = {}) {
  const list = Array.isArray(paths) ? paths.map((p) => String(p ?? '').trim()).filter(Boolean) : [];
  if (!list.length) return [];
  if (list.length > MAX_IMAGES) throw fail('too-many-images');
  const out = [];
  for (const p of list) {
    const abs = path.isAbsolute(p) ? p : path.resolve(p);
    if (!withinAnyRoot(abs, allowedRoots)) continue;   // 远程访问时只允许项目根内
    try { out.push(readImage(abs)); }
    catch (e) {
      const code = (e && e.code) || 'image-missing';
      if (code === 'image-missing' || code === 'bad-image') continue;   // 找不到就忽略
      throw e;
    }
  }
  return out;
}

// 文本里的图片路径 → data URL 数组（兼容「路径写在提示词里」的用法）
export function resolveImages(text, opts) {
  return resolveImageList(extractImagePaths(text), opts);
}

// 剥掉 provider 前缀（deepseek/deepseek-v4-flash → deepseek-v4-flash）
export function normalizeModel(raw, models = [], fallback = '') {
  const s = String(raw ?? '').trim() || String(fallback ?? '').trim();
  if (s) return s.includes('/') ? s.slice(s.indexOf('/') + 1) : s;
  return models[0] || '';
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function createTranslator({
  provider = () => null,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxLen = MAX_INPUT_CHARS,
  readImage = readImageFile,
} = {}) {
  async function translate({ text = '', model = '', images = [], allowedRoots = null } = {}) {
    const input = String(text ?? '').trim();
    const explicit = Array.isArray(images) ? images.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    if (!input && !explicit.length) throw fail('empty-input');
    if (input.length > maxLen) throw fail('too-long');
    // 显式选图（选图框）与文本里的图片路径合并去重
    const paths = [...new Set([...explicit, ...extractImagePaths(input)])];
    const imageUrls = resolveImageList(paths, { allowedRoots, readImage });
    const p = (await provider()) || null;
    if (!p || !p.baseURL) throw fail('no-provider');
    if (!p.apiKey) throw fail('no-key');
    const models = Array.isArray(p.models) ? p.models : [];
    // provider.models 可能是裸名（opencode.json）或 provider/model（opencode models），统一成裸名比较
    const bare = models.map((x) => { const s = String(x); return s.includes('/') ? s.slice(s.indexOf('/') + 1) : s; });
    const m = normalizeModel(model, bare, p.model);
    if (!m) throw fail('bad-model');
    if (bare.length && !bare.includes(m)) throw fail('bad-model');

    const url = `${String(p.baseURL).replace(/\/+$/, '')}/chat/completions`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
        body: JSON.stringify({ model: m, messages: buildMessages(input || 'See the attached image.', imageUrls), stream: false }),
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) throw fail('timeout');
      throw fail('upstream', (e && e.message) || String(e));
    }
    clearTimeout(timer);
    if (!res || !res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j && (j.error?.message || j.message || j.error)) || '';
      } catch { /* keep empty */ }
      throw fail('upstream', `HTTP ${res ? res.status : '?'}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
    }
    let json;
    try { json = await res.json(); } catch { throw fail('upstream', 'invalid JSON response'); }
    const content = json?.choices?.[0]?.message?.content;
    const out = typeof content === 'string' ? content.trim() : '';
    if (!out) throw fail('empty-result');
    return { text: out, model: m };
  }
  return { translate };
}

// 解析 `opencode models <provider>` 输出：每行 `provider/model`，只留指定 provider 并去重
export function parseModelList(output, providerId = '') {
  const out = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const s = line.trim();
    const i = s.indexOf('/');
    if (i <= 0 || i === s.length - 1) continue;
    if (providerId && s.slice(0, i) !== providerId) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

// 跑 `opencode models <provider>` 取与 opencode 一致的模型清单（短 TTL 缓存，避免每次配置请求都拉起 CLI）
export function createModelLister({ bin = 'opencode', spawnFn = spawn, timeoutMs = MODELS_TIMEOUT_MS, ttlMs = MODELS_TTL_MS } = {}) {
  const cache = new Map();
  function exec(providerId) {
    return new Promise((resolve) => {
      let child;
      try { child = spawnFn(bin, ['models', providerId], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
      catch { return resolve([]); }
      const out = [];
      let done = false;
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } if (!done) { done = true; resolve([]); } }, timeoutMs);
      child.stdout?.on('data', (c) => out.push(Buffer.from(c)));
      child.on('error', () => { if (done) return; done = true; clearTimeout(timer); resolve([]); });
      child.on('close', (code) => { if (done) return; done = true; clearTimeout(timer); resolve(code === 0 ? parseModelList(Buffer.concat(out).toString('utf8'), providerId) : []); });
    });
  }
  return async (providerId) => {
    if (!providerId) return [];
    const hit = cache.get(providerId);
    if (hit && Date.now() - hit.at < ttlMs) return hit.list;
    const list = await exec(providerId);
    if (list.length) cache.set(providerId, { at: Date.now(), list });
    return list;
  };
}

// 默认 provider 的目录：模型清单优先取 `opencode models`（与 opencode 选择一致），失败回退 opencode.json 的 models。
// 每次调用都重读配置与清单（清单有短缓存），改 opencode.json 后无需重启。
export function createCatalogSource({ listModels = createModelLister(), resolveProvider = defaultGetProvider, loadProviders = loadOpencodeProviders } = {}) {
  async function build() {
    const { defaultProvider, model } = loadProviders();
    const p = defaultProvider ? resolveProvider(defaultProvider) : null;
    if (!p || !p.baseURL) return { provider: null, models: [], model: '', hasKey: false, resolved: null };
    const fallback = (Array.isArray(p.models) ? p.models : []).map((m) => `${p.id}/${m}`);
    const listed = await listModels(p.id);
    const models = listed.length ? listed : fallback;
    const rawModel = String(model || p.model || '');
    const full = rawModel ? (rawModel.includes('/') ? rawModel : `${p.id}/${rawModel}`) : '';
    const selected = models.includes(full) ? full : (models[0] || '');
    return { provider: p.id, models, model: selected, hasKey: !!p.apiKey, resolved: p };
  }
  return { build };
}

// 供前端下拉与「未配置」提示（脱敏：不含任何密钥）
export function defaultCatalog(opts) {
  const { build } = createCatalogSource(opts);
  return async () => {
    const { provider, models, model, hasKey } = await build();
    return { provider, models, model, hasKey };
  };
}

// 直连用的 provider 解析：defaultProvider + 真实 key/baseURL + 与 opencode 一致的模型清单与默认模型
export function defaultProviderResolver(opts) {
  const { build } = createCatalogSource(opts);
  return async () => {
    const { resolved, models, model } = await build();
    return resolved ? { ...resolved, models, model } : null;
  };
}

const BAD_INPUT = new Set(['empty-input', 'too-long', 'no-provider', 'no-key', 'bad-model', 'image-too-large', 'too-many-images']);

export function createTranslateMount({ translator, catalog = defaultCatalog(), logger = console, isLocal = () => true, projectRoots = () => [] } = {}) {
  async function route(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/api/translate/config' && req.method === 'GET') {
      try { return sendJson(res, 200, await catalog()); }
      catch (e) { logger?.warn?.('translate config failed', (e && e.message) || e); return sendJson(res, 500, { error: 'internal' }); }
    }
    if (path === '/api/translate' && req.method === 'POST') {
      let body;
      try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'bad-body' }); }
      // 远程访问时只允许读项目根内的图片，避免受邀者借路径读本机任意文件
      const allowedRoots = isLocal(req) ? null : projectRoots();
      try {
        const r = await translator.translate({ text: body.text, model: body.model, images: body.images, allowedRoots });
        return sendJson(res, 200, { text: r.text, model: r.model });
      } catch (e) {
        const code = (e && e.code) || 'internal';
        const status = BAD_INPUT.has(code) ? 400 : code === 'timeout' ? 504 : code === 'upstream' ? 502 : 500;
        if (status >= 500) logger?.warn?.('translate failed', (e && e.message) || e);
        return sendJson(res, status, { error: code, message: (e && e.message) || '' });
      }
    }
    return sendJson(res, 404, { error: 'not found' });
  }
  return route;
}
