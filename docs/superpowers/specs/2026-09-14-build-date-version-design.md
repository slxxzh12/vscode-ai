# 设计文档：服务版本号（打包日期版，vYYYYMMDD）

日期：2026-09-14
分支：master
状态：待评审

## 1. 概述

当前项目没有任何"服务版本"概念：`package.json` 为 `0.1.0`，顶栏与「设置 → 关于」均不显示版本，构建产物名固定为 `vscode-ai-windows-<arch>` / `vscode-ai-macos-<arch>`。

用户要求：给服务加一个**按打包当天日期生成**的版本号（如今天 = `v20260914`），并作为**全局唯一事实源**，体现在：

1. 顶栏品牌名旁边常显；
2. 「设置 → 关于」页显示；
3. 构建产物目录名 / zip 名带版本。

### 已与用户确认的约束

- 版本号**自动取打包当天日期**生成，不手动维护。
- 格式：`v` + `YYYYMMDD`（今天 `v20260914`）；产物 `vscode-ai-windows-x64-v20260914.zip`。
- 前端**通过 `/api/version` 向服务端拉取**，服务端为运行时唯一事实源（不在前端构建期再取一次日期）。
- `package.json` 的 `version` 保持 `0.1.0`，不改；不引入手动 bump 机制。

## 2. 版本生成与解析

### 2.1 唯一格式化函数 `shared/version.cjs`

新增 CJS 模块（`.cjs` 不受 `shared/package.json` 的 `type:module` 影响，可同时被 ESM 服务端与 CJS 构建脚本复用）：

```
todayVersion(date = new Date()) -> 'v' + YYYY + MM + DD   // 如 'v20260914'
```

- 月/日 `padStart(2,'0')`。
- 导出方式：`module.exports = { todayVersion }`。

### 2.2 服务端解析 `server/version.js`

按优先级解析，导出 `VERSION` 与 `resolveVersion()`：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `process.env.DEVFLOW_VERSION` | 显式覆盖（CI / 调试用） |
| 2 | `<ROOT>/version.txt` | 打包产物根目录的冻结值（`ROOT = server 的上一级`） |
| 3 | `todayVersion()` | 开发态回退 = 当天 |

- `version.txt` 不存在（dev）→ 回退当天，因此 `npm run dev:server` 也自动显示当天版本。
- 读取失败/空串一律视为不存在，不抛错。
- 通过 `@devflow/shared/version.cjs` 引入格式化函数（需在 `shared/package.json` 的 `exports` 增加 `"./version.cjs"` 条目）。

## 3. 服务端接入

- `server/index.js`：
  - 启动成功日志追加版本，形如 `listening on http://HOST:PORT  (ws: ...)  version v20260914`。
  - 新增 `GET /api/version` → `{ "version": "v20260914" }`；放在配置级接口区（与 `/api/agents`、`/api/workflows-xml` 并列），**无需选择数据档案**即可访问。
- 该接口只返回版本字符串，无用户可见文案、无 i18n 需求；鉴权沿用现有 `requireAuthHttp` 与远程门禁逻辑（远程未授权时按既有规则 403）。

## 4. 构建脚本接入

### 4.1 `scripts/build.js`（Windows）

- 启动时 `require('../shared/version.cjs').todayVersion()` 得到 `VERSION`。
- 产物命名改为：
  - 目录：`dist-portable/vscode-ai-windows-<arch>-<VERSION>/`
  - 压缩：`dist-portable/vscode-ai-windows-<arch>-<VERSION>.zip`
- 在产物根写入 `version.txt`（内容 = `VERSION`），供服务端 `server/version.js` 读取冻结值。
- 控制台打印 `[build] version <VERSION>`；`使用说明.txt` 顶部追加版本行。

### 4.2 `scripts/build-mac.js`（macOS，分架构）

- 同样 `require('../shared/version.cjs')` 取 `VERSION`（同一次执行两个架构共用同一版本）。
- 产物命名：`vscode-ai-macos-<arch>-<VERSION>/` + `.zip`；各架构目录根写入 `version.txt`。
- 打印版本。

> 注：Windows 与 macOS 仍各用各的脚本，不交叉；两脚本共享同一 `shared/version.cjs` 格式化函数，保证命名与冻结值一致。

## 5. 前端接入

### 5.1 组合式函数 `web/src/useVersion.ts`

- 模块级缓存 + 单次请求：`fetch('/api/version')` → `version: string`；失败回退空串（不显示）。
- 导出 `version`（`Ref<string>`）与 `loadVersion()`；`App.vue` 挂载时调用一次，`TerminalView.vue` 复用同一缓存（不重复请求）。

### 5.2 展示位置

- `App.vue` 顶栏：品牌 `◈ {{ $t('brand.title') }}` 之后追加 `<span class="app-ver">{{ version }}</span>`（仅当非空时渲染），并加少量样式（弱化色、等宽字体）。
- `TerminalView.vue` 关于页第一个 `setsec` 内新增一行：
  `<div class="aboutrow"><span class="aboutk">{{ $t('term.about.version') }}</span><span class="aboutv">{{ version }}</span></div>`

## 6. i18n 词条

`shared/i18n/zh-CN.js` 与 `en.js` 对称新增：

| key | zh-CN | en |
| --- | --- | --- |
| `term.about.version` | 版本 | Version |

（顶栏仅显示原始 `v20260914` 字符串，无需词条。）

## 7. 文档同步

- 更新 `AGENTS.md` 中 Windows / macOS 产物命名说明两处，补充 `-vYYYYMMDD` 后缀与 `version.txt` 说明。
- `scripts/build.js` 的「使用说明.txt」加入版本行（见 4.1）。

## 8. 测试与验收

- 单测 `server/test/version.test.js`：
  - `DEVFLOW_VERSION` 覆盖优先；
  - 存在 `version.txt` 时读取其内容；
  - 两者都没有时返回 `todayVersion()` 且匹配 `/^v\d{8}$/`；
  - `todayVersion(new Date(2026, 8, 14))` === `'v20260914'`（验证补零）。
- i18n：`npm.cmd run check:i18n` 通过；`term.about.version` 中英均存在。
- 类型检查：`npm.cmd run typecheck` 通过；全量 `npm.cmd test` 通过。
- 人工验收：
  1. `npm run dev:server` + `npm run dev:web` → 顶栏与关于页显示当天 `vYYYYMMDD`；
  2. `npm run build:web` + `node scripts/build.js` → 产物目录/zip 含 `-vYYYYMMDD`，包内 `version.txt` 为该值；
  3. 运行绿色包 → 假若跨天，仍显示打包当天版本（冻结生效）。

## 9. 明确不做

- 不做语义化版本 / 手动 bump。
- 不改 `package.json` 的 `version`。
- 不做「构建期把版本写死进前端」（用 API 保证运行时单源）。
- 不做前端离线兜底文案（拉取失败即不显示）。

## 10. 决策记录

- 生成方式：打包当天日期自动生成（用户选 2）。
- 展示格式：带 `v` 前缀（用户选 2）。
- 获取方式：服务端 API 单源（方案 A），避免前端构建期二次取日期导致跨午夜不一致。
- 冻结载体：产物根 `version.txt`（gitignore 范围外、随包分发，手动启动 `runtime\node.exe server\index.js` 也生效）。
- 格式化函数放 `shared/version.cjs`：CJS/ESM 双端可复用，避免在构建脚本里复制日期格式逻辑。
