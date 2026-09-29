import { VISION_SYSTEM, parseMetrics } from './usage-vision.js';

// 组装多模态识别消息：系统提示词（只返回 JSON 指标）+ 用户文本 + 截图 dataURL
export function buildVisionMessages({ mime = 'image/png', data }) {
  const dataUrl = `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
  return [
    { role: 'system', content: VISION_SYSTEM },
    { role: 'user', content: [
      { type: 'text', text: 'Extract the stats from this screenshot.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ] },
  ];
}

async function postJson(fetchFn, url, token, body, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DF-Token': token }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    const x = new Error('timeout');
    x.code = (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) ? 'timeout' : 'upstream';
    throw x;
  }
  clearTimeout(timer);
  if (!res || !res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j && (j.message || j.error)) || ''; } catch { /* keep */ }
    const x = new Error(detail || `HTTP ${res ? res.status : '?'}`);
    x.code = (res && res.status === 403) ? 'bad-token' : 'upstream';
    throw x;
  }
  return res.json();
}

// 成员侧：把截图交给群主多模态接口识别 → 解析指标 → 上报群主落库（不写成员本机）
export async function recognizeViaMaster({ masterUrl, token, data, mime, identity, days, fetchFn = fetch, timeoutMs = 60000 }) {
  const base = String(masterUrl || '').replace(/\/+$/, '');
  const messages = buildVisionMessages({ mime, data });
  const r = await postJson(fetchFn, `${base}/api/usage/multimodal`, token, { messages, model: 'image' }, timeoutMs);
  const metrics = parseMetrics(r.content);
  await postJson(fetchFn, `${base}/api/usage/report`, token, {
    machineId: identity.machineId, username: identity.username || '',
    host: identity.host || '', port: Number(identity.port) || 0,
    usage: { ...metrics, source: 'image', days },
  }, timeoutMs);
  return { metrics, model: r.model, reported: true, via: 'master' };
}
