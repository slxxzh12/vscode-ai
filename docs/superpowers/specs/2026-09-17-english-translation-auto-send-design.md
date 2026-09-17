# 设计文档：英文翻译右栏自动发送

日期：2026-09-17
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

终端底部输入框的「英文翻译」模式（`web/src/components/TerminalView.vue` 的 `translateMode`）当前行为是：回车即「翻译 + 立即送入会话」，中英文两栏随后一起清空。本设计改为**翻译与发送解耦**：

- 左侧中文框回车 → 只翻译，译文填入右侧英文框，**不发送**。
- 右侧英文框带一个 **自动发送** 勾选框（默认勾选，状态存服务端端口数据目录）。
- 勾选时：译文进入右栏后开始 3 秒倒计时，倒计时结束自动送入会话。
- 未勾选时：需在右栏再按一次回车（或点「发送」）才送入。

同时增加一条**跳过翻译**的快捷路径：输入若为纯 ASCII（字母/数字/空白/ASCII 标点），不调用大模型，直接原样填入右栏，再走同一套自动发送规则。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 倒计时展示 | 显示倒计时（3→2→1），**无取消按钮**；编辑右栏会**重置** 3 秒计时（保留编辑内容） |
| 2 | 勾选框 | **默认勾选**；持久化到**服务端端口数据目录**（非 localStorage） |
| 3 | 左栏编辑 | 倒计时期间编辑左栏 → **取消**本次待发送；不自动重译，需再回车 |
| 4 | 发送后 | 中英两栏**都清空**；中文只进消息历史 |
| 5 | 纯 ASCII 输入 | 跳过大模型，原样填入右栏，之后**沿用正常规则**（勾选则 3 秒后自动发，未勾选则回车发） |
| 6 | 会话切换 | 倒计时**不取消**；发送到「译文填入时处于活动的那个会话」 |
| 7 | ASCII 判定 | 全部字符都在 ASCII 范围（`A-Za-z0-9`、空白、ASCII 标点）即跳过翻译 |
| 8 | 目标会话已非当前活动标签 | **静默发送**，不切回视图（给 `C2S.INPUT` 加可选 `sessionId`） |

## 2. 现状与落点

现有实现（改动前）：

- `TerminalView.vue:416-460` — `translateMode` / `translatedText` / `translating` / `lastTranslatedSource` / `lastTranslateResult` 与 `runTranslate()`（`POST /api/translate`，错误码映射 `TRANSLATE_ERR_KEY`）。
- `TerminalView.vue:588-608` — `submitComposer()`：翻译模式下必要时先翻译，然后 `sendToActive(text)` 并清空两栏、`msgHistory.push(text, …)`。
- `TerminalView.vue:609-611` — `onComposerKey()`，左右两个 textarea 共用。
- 偏好持久化的现成范式：`server/code-prefs.js` + `server/json-store.js` + `GET/POST /api/code/prefs` + `web/src/codePrefs.ts`（`portPaths.codePrefsFile`）。
- `C2S.INPUT` 服务端只写 `conn.sessionId`（`server/ws-gateway.js:97-99`），故无法向非活动会话发送。

## 3. 服务端

### 3.1 `server/composer-prefs.js`（新增）

与 `code-prefs.js` 同构：

- `normalizeComposerPrefs(input)`：只保留已知键，目前仅 `autoSend` 且仅接受 boolean；缺失键 = 用前端默认值（`true`）。
- `createComposerPrefs({ file, logger })`：`createJsonStore({ file, logger, normalize, defaults: () => ({}) })`。

### 3.2 接线

- `server/port-paths.js`：新增 `composerPrefsFile: path.join(dir, 'composer-prefs.json')`。
- `server/http-api.js`：`createHttpApi({ …, composerPrefs = createComposerPrefs({}) })`；新增 `GET /api/composer/prefs`（`read()`）与 `POST /api/composer/prefs`（`write(body)`，返回归一化结果）。
- `server/index.js`：`const composerPrefs = createComposerPrefs({ file: paths.composerPrefsFile, logger: log })`，传入 `createHttpApi`。

数据落盘位置：`<dataHome>/ports/<端口>/composer-prefs.json`，与端口数据目录一致，一个端口一份。

### 3.3 `C2S.INPUT` 可选 `sessionId`

- `server/ws-gateway.js:97-99` 改为：
  ```js
  case C2S.INPUT: {
    const sid = msg.sessionId || conn.sessionId;
    if (sid) sessionManager.write(sid, msg.data);
    break;
  }
  ```
- 向后兼容：不带 `sessionId` 时行为不变；`shared/` 协议常量无需改动（沿用 `C2S.INPUT`，仅新增可选字段）。
- 目标会话已被 kill 时，`sessionManager.write` 对未知 id 无副作用（不报错、不误写其它会话）。

## 4. 前端

### 4.1 `web/src/useTerminal.ts`

`input(data: string, sessionId: string | null = null)` → `send(C2S.INPUT, { data, sessionId })`（`sessionId` 为 `null` 时保持原语义）。

### 4.2 `web/src/useEnglishComposer.ts`（新增）

把翻译模式的状态机从 `TerminalView.vue` 抽出，便于单测：

```ts
useEnglishComposer({
  translate,            // (text) => Promise<string>，默认 POST /api/translate
  getActiveSessionId,   // () => string | null
  send,                 // (text, sessionId) => void：写入 + 回车
  recordHistory,        // (sourceText, sessionId) => void
  onError,              // (tKey, params) => void，默认 alert(t(...))
})
```

状态：`on`（= 原 `translateMode`）、`source`（左栏）、`translated`（右栏）、`translating`、`autoSend`、`countdown`（`number | null`）。

内部：`lastSource` / `lastResult`（判是否手动编辑过）、`pending`（`{ text, sid, timer, tick }` 或 `null`）、`settingTranslated` 标志（区分程序赋值与用户编辑）。

动作：

- `translateNow()`：取 `source.trim()`；空则返回 `false`。纯 ASCII → 直接 `translated = text`（不发请求）；否则调用 `translate`，失败走 `onError` 并返回 `false`。成功后置 `lastSource/lastResult`，再 `arm()`。
- `arm()`：`autoSend && translated.trim()` 时记录 `sid = getActiveSessionId()`，启动 3 秒倒计时（1 秒一跳，归零触发发送）。
- `disarm()`：清定时器并置 `countdown = null`。
- `sendNow()`：`translated` 为空则不动作；否则取目标会话 `sid = pending?.sid ?? getActiveSessionId()`，清计时器，`send(translated.trim(), sid)`、`recordHistory(source.trim() || translated.trim(), sid)`、清空两栏并复位。
- `toggle()` / `setAutoSend(v)`：`setAutoSend(true)` 时若右栏非空则 `arm()`，置 `false` 则 `disarm()`。

监听：

- `source` 变化 → `disarm()`（决定 3）。仅在无 `pending` 时为空操作；清空两栏时同样只是空操作。
- `translated` 变化且处于 `settingTranslated` 标记之外 → 若有 `pending` 则**重启** 3 秒计时（决定 1）；若变空则 `disarm()`。程序赋值（`translateNow` 填入译文）带标记，不触发重启。
- `autoSend` 变化 → 按 `setAutoSend` 规则处理。

偏好同步：`load()` 时 `GET /api/composer/prefs`，`merge` 后取 `autoSend`（缺键默认 `true`）；`autoSend` 改动去抖 `POST`（参照 `web/src/codePrefs.ts`）。

### 4.3 `web/src/components/TerminalView.vue`

- `composerText` 改由 `useEnglishComposer` 的 `source` 承担（`v-model`、chips/阶段/选文件写入点全部替换）。
- 左栏 `keydown.enter` → `translateNow()`；右栏 `keydown.enter` → `sendNow()`（两栏分开处理，不再共用 `onComposerKey`）。
- 「翻译」按钮 → `translateNow()`；「发送」按钮 → 翻译模式且有译文时 `sendNow()`，否则 `translateNow()` 成功后 `sendNow()`。
- 右栏上方新增勾选框：`<input type="checkbox">` + 文案 `term.auto_send`；倒计时期间同行显示 `term.auto_send_countdown`（`{n}` 秒）；标题提示 `term.auto_send_hint`。
- 倒计时可视化：右栏底部一条细进度条（`width` 随剩余秒数递减），「发送」按钮文案在倒计时期间显示 `发送 (n)`。
- 非翻译模式完全不变（回车仍直接发送）。

### 4.4 i18n

`shared/i18n/zh-CN.js` 与 `en.js` 同步新增（键集合保持对称）：

- `term.auto_send`：`自动发送` / `Auto-send`
- `term.auto_send_hint`：`译文进入右栏后 3 秒自动送入会话` / `Send the translation 3s after it lands in the right box`
- `term.auto_send_countdown`：`{n} 秒后自动发送` / `Auto-sending in {n}s`
- 更新 `term.translated_ph`：说明可编辑且会按自动发送规则送出。

## 5. 边界情况

- 左栏空 + 回车：不动作（不触发翻译、不发送）。
- 右栏空：不发送、`disarm()`。
- 倒计时中手动发送（右栏回车 / 发送按钮）：立即发送并清计时器。
- 倒计时中左栏被改：取消待发送，右栏保留旧译文，需再次回车重译。
- 倒计时中右栏被改：保留改动，重新计 3 秒。
- 纯 ASCII 输入：不调用 `/api/translate`，但仍遵守自动发送规则。
- 翻译失败：沿用 `TRANSLATE_ERR_KEY` 提示，不进入倒计时、不发送。
- 目标会话在倒计时期间被 kill：静默发送无副作用（服务端忽略未知 id）。
- 刷新页面：倒计时不持久化，恢复为空闲状态；勾选状态从服务端读回。

## 6. 测试与验证

- `server/test/composer-prefs.test.js`（新增）：归一化只留 `autoSend`、非 boolean 丢弃、JSON 存取回读。
- `server/test/http-api.test.js`（扩展）：`GET /api/composer/prefs` 默认空、`POST` 只存已知键。
- `server/test/ws-gateway.test.js`（扩展）：带 `sessionId` 的 `C2S.INPUT` 写入指定会话而非活动会话；不带的仍写活动会话。
- `web/src/useEnglishComposer.test.ts`（新增，vitest + fake timers）：ASCII 跳过请求；含中文触发翻译；勾选后倒计时归零发送；编辑左栏取消；编辑右栏重置计时；发送到捕获的 `sid`；手动发送清计时；未勾选不自动发送；发送后清空两栏且历史记录中文原文。
- 命令：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run check:i18n`。

## 7. 影响面

- 新增：`server/composer-prefs.js`、`web/src/useEnglishComposer.ts`、两份测试、本设计文档。
- 修改：`server/port-paths.js`、`server/http-api.js`、`server/index.js`、`server/ws-gateway.js`、`web/src/useTerminal.ts`、`web/src/components/TerminalView.vue`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`。
- 不改：协作子系统、`shared/` 协议常量、绿色包打包脚本（无新增运行时依赖）。
