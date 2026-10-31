import { isVisionModel } from '@devflow/shared/llm-presets';

// 统计截图多模态识别：读 opencode.json 的 provider（视觉模型优先），把截图发给模型，
// 让它只返回一个 JSON 对象，解析出 sessions/messages 等指标写回用量库。
// 复用 translate.js 的 provider 解析（defaultProviderResolver）注入，避免重复读 opencode.json。

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const VISION_SYSTEM = [
  'You extract usage statistics from a screenshot of an AI coding tool\'s usage/stats output.',
  'The screenshot may be one of these layouts:',
  '1. An aggregate summary with labeled rows (e.g. Sessions, Messages, Days, Total Cost, Input, Output, Cache Read, Cache Write).',
  '2. A list of individual sessions (session history), each showing its own input tokens and output tokens.',
  'If the screenshot is a session list, aggregate it into totals before replying:',
  '  "sessions" = number of sessions in the list,',
  '  "messages" = total messages across all sessions (if shown),',
  '  "input" = sum of all per-session input tokens,',
  '  "output" = sum of all per-session output tokens.',
  'Reply with ONLY a JSON object using exactly these keys, with null for any value you cannot find:',
  '{"sessions":<int>,"messages":<int>,"days":<int>,"totalCost":<number>,"input":<int>,"output":<int>,"cacheRead":<int>,"cacheWrite":<int>}',
  'No markdown, no explanation, no extra text.',
].join('\n');

const ROUND = { sessions: true, messages: true, days: true, input: true, output: true, cacheRead: true, cacheWrite: true, totalCost: false };
const KEYS = Object.keys(ROUND);

export function fail(code, message = '') {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function bareModel(s) {
  const str = String(s ?? '');
  return str.includes('/') ? str.slice(str.indexOf('/') + 1) : str;
}

// 从 provider 的模型清单里挑一个视觉模型，找不到回退第一个；返回裸名
export function pickModel(provider) {
  const models = (Array.isArray(provider && provider.models) ? provider.models : []).map(bareModel).filter(Boolean);
  const vision = models.find((m) => isVisionModel((provider && provider.id) || '', m));
  return { model: vision || models[0] || '', models };
}

// 从模型输出里抠 JSON（容忍 markdown 代码块 / 前后杂文）并归一化成指标
export function parseMetrics(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  let obj;
  try { obj = JSON.parse(s); } catch { throw fail('bad-json'); }
  const out = {};
  let any = false;
  for (const k of KEYS) {
    const raw = obj[k];
    const n = (raw === null || raw === undefined || raw === '') ? NaN : Number(raw);
    const v = Number.isFinite(n) ? (ROUND[k] ? Math.round(n) : n) : null;
    out[k] = v;
    if (v != null) any = true;
  }
  if (!any) throw fail('empty-result');
  return out;
}

// 通用 chat/completions 调用：model 缺省或哨兵名 'image' → 从 provider 模型清单挑多模态模型
export async function callChat({ resolveProvider, messages, model = 'image', fetchFn = fetch, timeoutMs = 60000 }) {
  if (!Array.isArray(messages) || !messages.length) throw fail('bad-messages');
  const p = (await resolveProvider()) || null;
  if (!p || !p.baseURL) throw fail('no-provider');
  if (!p.apiKey) throw fail('no-key');
  const chosen = (!model || model === 'image') ? pickModel(p).model : model;
  if (!chosen) throw fail('bad-model');
  const url = `${String(p.baseURL).replace(/\/+$/, '')}/chat/completions`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({ model: chosen, stream: false, messages }),
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
    try { const j = await res.json(); detail = (j && (j.error?.message || j.message || j.error)) || ''; } catch { /* keep empty */ }
    throw fail('upstream', `HTTP ${res ? res.status : '?'}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  }
  let json;
  try { json = await res.json(); } catch { throw fail('upstream', 'invalid JSON response'); }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw fail('empty-result');
  return { content, model: chosen };
}

export function createUsageVision({ resolveProvider = () => null, fetchFn = fetch, timeoutMs = 60000 } = {}) {
  async function recognize({ data, mime = 'image/png' }) {
    if (!Buffer.isBuffer(data) || data.length === 0) throw fail('empty-image');
    if (data.length > MAX_IMAGE_BYTES) throw fail('image-too-large');
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
    const messages = [
      { role: 'system', content: VISION_SYSTEM },
      { role: 'user', content: [
        { type: 'text', text: 'Extract the stats from this screenshot.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ];
    const r = await callChat({ resolveProvider, messages, model: 'image', fetchFn, timeoutMs });
    return { metrics: parseMetrics(r.content), model: r.model };
  }
  return { recognize };
}
