# 统计截图交群主识别（通用多模态接口） 设计

> 日期：2026-09-29
> 范围：用量统计截图多模态识别、协作用量上报通道、usage mount 端点

## 背景与目标

当前统计截图识别在**上传方本机**完成（`UsageProbeDialog.vue` → 本机 `POST /api/usage/image` → `server/index.js` 的 `onImage` 用本机 `opencode.json` 视觉模型识别）。问题：成员机没配视觉模型/密钥时无法识别。

目标：群主对外提供一个**通用多模态接口**（转发 `chat/completions`，模型取群主本机 `opencode.json` 配置的多模态模型）；成员机服务器带提示词与截图调用该接口，拿到模型输出后**自己解析**成指标，再上报群主按成员身份落库。成员本机只回显识别出的数字，不再需要视觉模型。群主不可达或识别失败直接报错，不做本机回退。

## 范围与取舍

- 识别模型：群主**从 LLM 中转站配置**（`server/llm-config.js`：`loadOpencodeProviders` 取默认 provider，`getProvider` 取 baseURL/key/models）的模型清单里挑多模态模型（哨兵名 `image`）。
- 解析位置：成员机服务器（`parseMetrics`）；落库位置：群主（按成员 machineId + username/host/port，`source='image'`）。
- 通道与鉴权：复用成员已有的上报目标（`reporter.config().masterUrl` + `token`），令牌 `X-DF-Token`（与 `/api/usage/report` 同把）。
- 群主本机上传截图：无 master 配置 → 走本机识别（原逻辑不变）。
- 成员共用同一把令牌，理论上可冒充他人 machineId；内网工具，接受。

## 群主端：通用多模态接口

### `usage-vision.js` 抽出 `callChat`
把现有 `createUsageVision.recognize` 里的「解析 provider → 选模型 → 请求 chat/completions → 取 content」抽成独立函数，供本机识别与多模态转发共用：

```js
export async function callChat({ resolveProvider, messages, model = 'image', fetchFn = fetch, timeoutMs = 60000 }) {
  const p = (await resolveProvider()) || null;
  if (!p || !p.baseURL) throw fail('no-provider');
  if (!p.apiKey) throw fail('no-key');
  // model 缺省或哨兵名 'image' → 从本机 opencode.json 挑一个多模态模型；传了真实模型名则直接用
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
    try { const j = await res.json(); detail = (j && (j.error?.message || j.message || j.error)) || ''; } catch { /* keep */ }
    throw fail('upstream', `HTTP ${res ? res.status : '?'}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  }
  let json;
  try { json = await res.json(); } catch { throw fail('upstream', 'invalid JSON response'); }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw fail('empty-result');
  return { content, model: chosen };
}
```

`createUsageVision.recognize` 改为：组装 messages → `callChat` → `parseMetrics(content)`（行为不变）。

### `usage-mount.js` 新增端点
`POST /api/usage/multimodal`：
- 头 `X-DF-Token` 走 `checkToken`，失败 `403 bad-token`。
- body JSON（本路由上限放宽到 10MB）：`{ messages: Array, model?: string }`，`model` 缺省为哨兵名 `"image"`；`messages` 非数组/空 → `400 bad-body`。
- 调注入回调 `onMultimodal({ messages, model })`，返回 `{ content, model }`。`model === 'image'` 时由 `callChat` 从群主本机 `opencode.json` 挑多模态模型，否则用给定模型名。
- 错误映射沿用 vision：`no-provider/no-key/bad-model/empty-result` → 400，`timeout` → 504，`upstream` → 502，其它 500。

### `index.js` 装配
```js
onMultimodal: async ({ messages, model }) => {
  // 从 LLM 中转站配置取默认 provider（与中转站同一份 opencode.json / provider 解析）
  const { defaultProvider } = loadOpencodeProviders();
  const p = defaultProvider ? getProvider(defaultProvider) : null;
  return callChat({ resolveProvider: async () => p, messages, model });
},
```
（`loadOpencodeProviders` / `getProvider` 来自 `server/llm-config.js`。）

## 成员端：识别 + 上报

新模块 `server/usage-recognize.js`：

```js
import { VISION_SYSTEM, parseMetrics } from './usage-vision.js';

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

async function postJson(fetchFn, url, token, body, timeoutMs = 60000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DF-Token': token }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    const x = new Error('timeout'); x.code = (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) ? 'timeout' : 'upstream'; throw x;
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
```

`server/index.js` 的 `onImage` 改分支：

```js
onImage: async ({ data, mime }) => {
  const cfg = usageReporter.config();
  if (cfg && cfg.masterUrl && cfg.token) {
    return recognizeViaMaster({ masterUrl: cfg.masterUrl, token: cfg.token, data, mime, identity: engine.pub, days: usageReporter.config().days });
  }
  const vision = createUsageVision({ resolveProvider: defaultProviderResolver() });
  const { metrics, model } = await vision.recognize({ data, mime });
  const a = defaultAgent();
  const rep = await usageReporter.reportImage({ agent: a.cmd, ...metrics, days: usageReporter.config().days });
  return { metrics, model, reported: !!rep.ok, reportError: rep.error || '' };
},
```

前端 `UsageProbeDialog.vue` 上传交互不变；识别结果区当 `via === 'master'` 时额外显示一行 `usage.probe.image_via_master`。

## 提示词与模型哨兵

提取指标的系统提示词沿用 `usage-vision.js` 的 `VISION_SYSTEM`（要求模型只返回固定 JSON），由成员机在 `buildVisionMessages` 里带上；`parseMetrics` 复用同一 JSON 契约。

模型名约定：请求未指定 `model` 或传哨兵名 `"image"` 时，群主从 LLM 中转站（`llm-config.js`：`loadOpencodeProviders` 默认 provider + `getProvider`）的模型清单里挑一个多模态模型（`pickModel`：预设 `vision` 标记或模型名含 `vision/vl/4v/omni`，无则回退第一个）；传真实模型名时直接使用。

## i18n

中英对称补齐：`usage.probe.image_via_master`（识别来源：群主 / Recognized by master）。

## 测试

- `server/test/usage-vision.test.js`：`recognize` 回归仍过（`callChat` 抽取后行为不变）。
- `server/test/usage-recognize.test.js`：`buildVisionMessages` 结构；`recognizeViaMaster` 调两次 fetch（multimodal + report）且 URL/头/体正确、返回 `via:'master'`；403 → `bad-token`；非 2xx → `upstream`；abort → `timeout`；`parseMetrics` 错误传播（`bad-json`）。
- `server/test/usage-report-http.test.js`：`POST /api/usage/multimodal` 令牌错误 403、坏 body 400、成功调 `onMultimodal` 并回内容、错误码映射。
- web：`UsageProbeDialog` 上传交互不变；当返回 `via === 'master'` 时显示一行 `usage.probe.image_via_master`，并断言该文案。

## 边界

- 成员未入群/未配置上报目标 → 走本机识别分支（等价现状）。
- 群主无多模态模型/无 key → 错误透传到成员界面。
- 图片/请求体上限 10MB；超时 60s。
