# 设计文档：用量上报接口 + 按天 SQLite 存储

日期：2026-09-12
分支：master
状态：待评审（已确认：无鉴权、快照覆盖、按天隔离、node:sqlite）

## 1. 概述

新增一个**用量上报接口**，接收用户发送过来的使用统计，按**天**隔离存入 **SQLite**（内置 `node:sqlite`，无第三方依赖），记录 `messages / output / input / sessions / days` 等信息。同一天同一成员同一 agent 重复上报**快照覆盖**（最后一次为准）。

现网用量机制（`server/collaboration/agent-stats.js` + 心跳）只保留「最新值」在内存 store，无按天历史；本功能补上按天历史存储，二者互不影响（上报方主动调用接口）。

## 2. 现状与扩展点

- 用量采集：`agent-stats.js` 的 `collectAgentStats` → `{ agent, days, sessions, messages, input, output, totalCost, cacheRead, cacheWrite, collectedAt }`。
- HTTP 网关：`server/index.js`，`/api/*` 分支（history / collab / scheduler / httpApi）；新路由插在 `/api/` 通用处理前。
- 固定数据目录：`server/data-home.js` 的 `dataHome()`。
- 内置驱动：`node:sqlite` 的 `DatabaseSync`（Node 24 已验证，无需 flag、无需原生编译，绿色包自带 node 可直接用）。

## 3. 存储模块 `server/usage-store.js`（新增）

- `createUsageStore({ file })`：`new DatabaseSync(file)`，启动执行建表；`file` 由调用方传入（便于测试注入临时路径）。
- 表：

```sql
CREATE TABLE IF NOT EXISTS usage (
  date TEXT NOT NULL,
  memberId TEXT NOT NULL,
  agent TEXT NOT NULL,
  sessions INTEGER,
  messages INTEGER,
  input INTEGER,
  output INTEGER,
  days INTEGER,
  cost REAL,
  cacheRead INTEGER,
  cacheWrite INTEGER,
  receivedAt INTEGER,
  PRIMARY KEY (date, memberId, agent)
);
```

- `upsert(rec)`：`INSERT INTO usage (...) VALUES (?,...) ON CONFLICT(date,memberId,agent) DO UPDATE SET <各字段>=excluded.<字段>, receivedAt=excluded.receivedAt`（**快照覆盖**）。
- `query({ from, to, memberId, agent } = {})`：按 `date`（可选区间）、`memberId`、`agent` 过滤，按 `date DESC, memberId, agent` 返回数组。
- `close()`：关闭数据库（测试用）。

数值归一放在路由层（见 §4），模块只做存取。

## 4. 接口

挂在 `server/index.js` 的 HTTP 网关（`/api/` 通用处理之前），无鉴权。

### 4.1 `POST /api/usage`（上报）

- body（JSON）：`{ memberId, agent?, date?, sessions?, messages?, input?, output?, days?, cost?, cacheRead?, cacheWrite? }`。
- 规则：
  - `memberId` 必填（trim 非空），否则 `400 { error: 'bad-input' }`。
  - `date` 缺省 = 服务器本地当天（`YYYY-MM-DD`）；提供则校验 `^\d{4}-\d{2}-\d{2}$`，不合法 → 400。
  - `agent` 缺省 `''`。
  - 数值字段用 `Number()` 归一；`NaN`/缺失存 `null`（`cost` 为浮点，其余取整）。
  - `receivedAt = Date.now()`。
- 成功：`200 { ok: true, date }`。

### 4.2 `GET /api/usage`（查询）

- query：`from?`、`to?`、`memberId?`、`agent?`。
- 成功：`200 { usage: [ ...记录 ] }`。

（无前端 UI；供脚本上报与人工核对。错误用英文错误码，不新增 i18n 词条。）

## 5. 接线

- `server/index.js`：import `createUsageStore` 与 `dataHome`；模块级 `const usageStore = createUsageStore({ file: path.join(dataHome(), 'usage.db') });`（与端口档案无关的固定位置）。
- 在 `/api/` 分支（`if (url.pathname.startsWith('/api/'))` 之前）插入 `/api/usage` 路由（POST/GET）。
- 不做鉴权；`/api/` 未就绪（`ws` 为空）时仍按现有 409 处理（用量存储不依赖工作区，但保持全局网关顺序一致；如需未就绪也可用，可在 409 检查前处理——本设计放在 409 **之前**，使上报不依赖工作区选择）。

## 6. 边界与取舍

- 无鉴权（内网使用），不做限流/配额；不对上报来源做真实性校验。
- 快照覆盖：同 `(date, memberId, agent)` 后写覆盖前写；不做追加历史。
- 数值上限不设；`date` 用服务器本地时区。
- DB 文件随用户数据目录，不入库；损坏/打不开时接口返回 500，不崩溃（模块构造失败在启动期可见）。
- 不做 UI、不做留存清理、不做与心跳自动打通、不做多表/多维度（如模型级）。

## 7. 测试与验收

- 单测 `server/test/usage-store.test.js`（node:test + 临时 db 文件）：
  - 首次 `upsert` 后 `query` 能取到；字段完整。
  - 同 `(date,memberId,agent)` 再次 `upsert` → **覆盖**（值更新、行数不变）。
  - 不同日期/成员/agent → 多行；`query` 过滤（from/to/memberId/agent）正确。
  - `query` 排序为 `date DESC`。
- 集成（可选，`createUsageStore` 注入 + 手写 http 请求）：POST 后 GET 能查到；缺 `memberId` 400；非法 `date` 400。
- 全量：`npm test`、`npm run typecheck`、`npm run check:i18n`、`npm run build:web` 全绿。
- 人工：`curl -X POST /api/usage -d '{"memberId":"E1","input":10,"output":20,"messages":3,"sessions":1,"days":1}'` → `{ok:true}`；`GET /api/usage?memberId=E1` 可见；再 POST 同天不同值 → GET 显示覆盖后的值。

## 8. 明确不做（YAGNI）

- 不做鉴权/签名/限流。
- 不做前端可视化与导出。
- 不做日志/审计留存与 TTL 清理。
- 不自动把现有心跳写入 SQLite（如需，后续单独接）。

## 9. 决策记录

- 用内置 `node:sqlite`（免原生依赖，兼容绿色包）：已验证可用。
- 无鉴权：用户明确。
- 按天隔离 + 快照覆盖：用户明确。
- DB 固定 `<dataHome>/usage.db`：沿用固定存储位置偏好。
