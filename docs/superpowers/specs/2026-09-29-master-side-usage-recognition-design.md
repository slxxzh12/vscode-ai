# 统计截图交群主识别 设计

> 日期：2026-09-29
> 范围：用量统计截图多模态识别、协作用量上报通道、usage mount 端点

## 背景与目标

当前统计截图识别在**上传方本机**完成（`UsageProbeDialog.vue` → 本机 `POST /api/usage/image` → `server/index.js` 的 `onImage` 用本机 `opencode.json` 视觉模型识别 → `usageReporter.reportImage` 只把数字上报群主）。问题：成员机没配视觉模型/密钥时无法识别。

目标：成员上传截图一律交**群主**识别（群主用自己的视觉模型），结果按上传成员身份写入**群主**的用量库；成员本机只回显识别出的数字，不再需要视觉模型。群主不可达或识别失败直接报错，不做本机回退。

## 范围与取舍

- 识别位置：一律群主（成员机无视觉模型要求）。
- 落库位置：只写群主；按上传者 machineId + username/host/port 归属，`source='image'`。成员本机不写。
- 通道与鉴权：复用成员已有的「上报目标」（`reporter.config().masterUrl` + `token`），成员本机服务端转发到群主识别端点，令牌用 `X-DF-Token`（与 `/api/usage/report` 同一把）。
- 群主本机上传截图：无 master 配置 → 走本机识别（原逻辑不变）。
- 成员共用同一把令牌，理论上可冒充他人 machineId 归属；内网工具，接受（写入说明）。
- 群主不可达/失败：成员界面直接报错，无本机回退。

## 群主端：新增识别端点

`server/usage-mount.js` 新增路由：

- `POST /api/usage/recognize?mime=&memberId=&username=&host=&port=`
  - 头 `X-DF-Token` 用现有 `checkToken` 校验，失败 `403 bad-token`。
  - raw 图片体（`readRaw`，上限沿用 10MB；超限 `413`）。
  - `memberId` 缺失 → `400 bad-body`。
  - 调注入回调 `onRecognize({ data, mime, memberId, username, host, port })`，返回 `{ metrics, model }`；错误映射沿用 `/api/usage/image`（`no-provider/no-key/bad-model/empty-image/image-too-large/bad-json/empty-result` → 400，`timeout` → 504，`upstream` → 502，其它 500）。

`server/index.js` 装配 `createUsageMount({ ..., onRecognize })`：

```js
onRecognize: async ({ data, mime, memberId, username, host, port }) => {
  const vision = createUsageVision({ resolveProvider: defaultProviderResolver() });
  const { metrics, model } = await vision.recognize({ data, mime });
  usagePeers.upsert({
    ...metrics, machineId: memberId, username, host, port: Number(port) || 0,
    source: 'image', days: usageReporter.config().days,
  }, Date.now());
  return { metrics, model };
},
```

（`usagePeers` 即 `engine.peers`；`defaultProviderResolver` 读群主本机 `opencode.json`。）

## 成员端：转发

新模块 `server/usage-recognize.js`：

```js
export async function forwardRecognize({ masterUrl, token, data, mime, identity, fetchFn = fetch, timeoutMs = 60000 }) {
  const base = String(masterUrl || '').replace(/\/+$/, '');
  const q = new URLSearchParams({ mime: mime || 'image/png', memberId: identity.machineId || '',
    username: identity.username || '', host: identity.host || '', port: String(identity.port || '') });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(`${base}/api/usage/recognize?${q}`, {
      method: 'POST', headers: { 'X-DF-Token': token, 'Content-Type': 'application/octet-stream' },
      body: data, signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) { const x = new Error('timeout'); x.code = 'timeout'; throw x; }
    const x = new Error((e && e.message) || String(e)); x.code = 'upstream'; throw x;
  }
  clearTimeout(timer);
  if (!res || !res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j && (j.message || j.error)) || ''; } catch { /* keep */ }
    const x = new Error(detail || `HTTP ${res ? res.status : '?'}`); x.code = (res && res.status === 403) ? 'bad-token' : 'upstream'; throw x;
  }
  return res.json();
}
```

`server/index.js` 的 `onImage` 改为分支：

```js
onImage: async ({ data, mime }) => {
  const cfg = usageReporter.config();
  if (cfg && cfg.masterUrl && cfg.token) {
    const r = await forwardRecognize({ masterUrl: cfg.masterUrl, token: cfg.token, data, mime, identity: engine.pub });
    return { metrics: r.metrics, model: r.model, reported: true, via: 'master' };
  }
  const vision = createUsageVision({ resolveProvider: defaultProviderResolver() });
  const { metrics, model } = await vision.recognize({ data, mime });
  const a = defaultAgent();
  const rep = await usageReporter.reportImage({ agent: a.cmd, ...metrics, days: usageReporter.config().days });
  return { metrics, model, reported: !!rep.ok, reportError: rep.error || '' };
},
```

前端 `UsageProbeDialog.vue` 上传交互不变；在识别结果区当 `via === 'master'` 时额外显示一行来源提示 `usage.probe.image_via_master`。

## i18n

中英对称补齐（`shared/i18n/zh-CN.js` + `en.js`）：
- `usage.probe.image_via_master`（识别来源：群主 / Recognized by master）。

## 测试

- `server/test/usage-recognize.test.js`：`forwardRecognize` 正确拼接 URL/头/体；403 → `bad-token`；非 2xx → `upstream`；Abort → `timeout`。
- `server/test/usage-report-http.test.js`：`POST /api/usage/recognize` 令牌错误 403、缺 memberId 400、成功调 `onRecognize` 并用成员身份 upsert（用注入回调断言）、空图/超限。
- `server/test/usage-vision.test.js`：现有用例不变。
- web：`UsageProbeDialog` 无新交互，可不加测试；若加来源提示则断言文案。

## 边界

- 成员不在任何群/未配置上报目标 → 走本机识别分支（等价现状）。
- 群主无视觉模型 → 识别失败错误透传到成员界面。
- 图片大小上限 10MB（沿用 `MAX_IMAGE_BYTES`）。
