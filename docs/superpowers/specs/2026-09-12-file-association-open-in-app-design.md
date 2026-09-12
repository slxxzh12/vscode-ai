# 设计文档：文件关联「用 Void 打开」并在界面展示

日期：2026-09-12
分支：master
状态：待评审（已与用户确认：方案 A、仅登记「打开方式」、首次运行弹窗、自动临时项目）

## 1. 概述

让 Windows 上的 `.md/.markdown/.yaml/.yml/.js/.mjs/.cjs/.json/.http/.rest/.curl` 文件能通过
「打开方式」用本软件打开：双击后启动/复用本地服务，浏览器打开深链 `?open=<绝对路径>`，
界面里直接展示该文件（命中已有项目则用该项目，否则自动以文件所在目录建**内存临时项目**）。

约束（已确认）：

- **只登记到「打开方式」列表**，不修改 `UserChoice`、不抢默认程序（Win10/11 无法静默强制默认）。
- **首次运行弹窗**询问是否登记，只问一次。
- 项目根之外的文件：**自动以所在目录作为临时项目**打开（不写入 `devflow.xml`）。

## 2. 现状与扩展点

- 启动器：`start.bat` → `script\launch.ps1`（由 `scripts/build.js` 生成；当前不接收参数）。
  绿色包无安装程序，路径随文件夹移动。
- 文件打开：`web/src/App.vue:366` 的 `openFile(projectId, path)` → `useCenter.openFile` →
  `FilePreview`。文件访问全部经 `projectId + 相对路径`。
- 项目模型：`server/projects.js` 的 `Projects`（`{id,name,root}`；`_filePath/_safeTarget` 做 root 越界校验）；
  `server/index.js:180` 用 `createHttpApi({..., repoRoot})`，项目列表 `GET /api/projects`。
- 工作区档案（profile）是另一层：`web/src/useWorkspace.ts`，`App.vue:384-398` 挂载时若
  `needSelect` 则先弹 `WorkspacePicker`。
- 品牌/图标：`icon.ico`（打包时从 favicon 拷贝）。

## 3. 总体方案（方案 A）

```
双击 .md（关联 → start.bat "%1"）
  └─ launch.ps1 -Open "C:\...\a.md"
       ├─ 复用/启动本地服务（现有逻辑）
       ├─ 打开浏览器 http://127.0.0.1:<port>/?open=<urlencoded 绝对路径>
       └─ 首次运行：弹窗询问 → 写 HKCU「打开方式」
  └─ App.vue 读到 ?open → POST /api/open-file {path}
       ├─ 命中已有项目根 → { projectId, rel }
       └─ 否则 addTempProject(dirname) → { project:{...temp:true}, rel }
  └─ 前端：loadProjects → selectProject → openFile → 清掉 ?open
```

## 4. 启动器 / 注册表

### 4.1 `start.bat`（`scripts/build.js` 生成）
透传参数：

```bat
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0script\launch.ps1" %*
```

### 4.2 `launch.ps1` 新增 `-Open <path>`
- 现有逻辑（读端口、探活、必要时启动服务、桌面快捷方式）保持不变。
- 若 `$Open` 非空：启动服务后打开
  `http://127.0.0.1:{0}/?open={1}`，其中 `{1} = [uri]::EscapeDataString($Open)`。
- 顺序：先确保服务 → 打开浏览器（含 `?open`）→ 创建快捷方式 → 首次运行关联弹窗（不阻塞打开）。

### 4.3 首次运行弹窗 + 登记
- 标记文件：`$env:APPDATA\devflow\assoc-prompted.txt`（不存在才弹）。
- 文案语言：优先读活动配置 `<dataHome>/downloads/devflow.xml` 的 `<server language>`，
  回退仓库模板，再回退 `zh-CN`；中文/英文各一份文案。
- 弹窗：`(New-Object -ComObject WScript.Shell).Popup(msg, 0, 'Void', 4+32+4096)`，返回 `6` 视为“是”。
- **登记内容（仅「打开方式」，无需管理员）**：
  - ProgID：`HKCU\Software\Classes\Void`
    - `(Default)` = `Void`
    - `shell\open\command\(Default)` = `"<root>\start.bat" "%1"`
    - `DefaultIcon\(Default)` = `"<root>\icon.ico"`
  - 每个扩展名 E：`HKCU\Software\Classes\.E\OpenWithProgids` 下设值 `Void`（类型 `REG_NONE`，空数据）。
  - 扩展名集合：`.md .markdown .yaml .yml .js .mjs .cjs .json .http .rest .curl`。
- 无论选“是/否”都写标记文件，避免重复打扰。
- v1 不提供“取消关联”；不因绿色包移动而自动重注册（登记的是当时绝对路径）。

## 5. 服务端

### 5.1 `server/projects.js`
- `addTempProject({ root, name })`：`id = 'tmp:' + sha1(realpath(root)).slice(0,8)`；若 id 已存在则直接复用；
  否则 push 到内存 `projects` 并更新 `_byId`，带 `temp: true`。**不**触发 `saveProjects`（不落 XML）。
- `resolveAbsolute(abs)`：
  1. `target = path.resolve(abs)`；`fs.statSync` 失败 → `not-found`；是目录 → `not-file`。
  2. 遍历现有项目（含临时）：若 target 落在某项目 `realpath(root)` 内 → 返回
     `{ projectId, rel: 相对路径(统一 `/`), project }`。
  3. 否则 `root = path.dirname(target)` 的 realpath，`addTempProject({root, name: basename(root)})`，
     返回 `{ projectId, rel: basename(target), project }`。

### 5.2 `server/http-api.js`
- 新增 `POST /api/open-file`，body `{ path }`；成功 `200 { ok:true, project:{id,name,root,temp}, rel }`。
- 错误映射：`not-found` → 404、`not-file` → 400。
- 复用现有 body 解析与错误分支。

## 6. 前端

### 6.1 `web/src/deeplink.ts`（新增纯函数）
- `parseOpenParam(search: string): string | null`：解析 `?open=` 并 `decodeURIComponent`，无则 `null`。

### 6.2 `web/src/useProjects.ts`
- 新增 `openPath(path: string): Promise<{ project: ProjectInfo & { temp?: boolean }; rel: string }>`：
  `POST /api/open-file`。

### 6.3 `web/src/App.vue`
- 挂载流程（`onMounted`）：工作区就绪后，若 URL 有 `?open=` 则记入 `pendingOpen`。
  若 `needSelect`（需先选档案）则**保留 query**，选完档案重载后再处理。
- 处理 `pendingOpen`：`openPath(path)` → `loadProjects()` → `selectProject(project.id)` →
  `openFile(project.id, rel)` → `history.replaceState` 去掉 `?open`（避免刷新重复打开）。
- 失败：`alert(t('open.failed', { msg }))`。
- 临时项目正常出现在项目下拉（`ProjectInfo` 增加可选 `temp?: boolean`，v1 不额外加徽标）。

### 6.4 类型
- `shared` 的 `ProjectInfo` 增加可选 `temp?: boolean`（可选字段，向后兼容）。

## 7. i18n

- 前端新增（中英对称）：`open.failed`（打开文件失败：{msg}）。
- 启动器弹窗文案在 `launch.ps1` 内按 `language` 出中/英两版（PowerShell 内联；不走 shared/i18n 运行时）。

## 8. 安全与边界

- `/api/open-file` 接受任意绝对路径：由用户本机双击触发，会以该文件所在目录建临时项目（用户已确认）；
  服务无鉴权，跨站请求虽拿不到 JSON（同源限制），但可能影响已打开页面——v1 接受此风险，不做 token。
- 仅文本可读；二进制由 `readText` 的 NUL 探测标记为 binary，UI 不展示内容。
- 绿色包移动后关联失效；不做自动重注册。
- `.js` 等常被系统占用，只进「打开方式」不抢默认。
- 临时项目仅存内存，重启后消失；不写 `devflow.xml`。

## 9. 测试与验收

- 单测：
  - `server/test/projects.test.js`（或新增 `open-file.test.js`）：`resolveAbsolute` 项目内命中、
    目录外建临时项目且重复调用复用、不存在 `not-found`、目录 `not-file`；`addTempProject` 不写盘。
  - `web/src/deeplink.test.ts`：`parseOpenParam` 正常/缺失/转义。
- 全量：`npm test`、`typecheck`、`check:i18n`、`build:web` 全绿。
- 人工验收：
  1. `node scripts/build.js` 后首次运行 `start.bat` → 弹窗选“是”→ 右键 `.md`「打开方式」出现 `Void`。
  2. 双击项目内的 `.md` → 浏览器打开并在 UI 展示该文件。
  3. 双击项目外目录的 `.yaml` → 自动以临时项目打开并展示，`devflow.xml` 未被修改。

## 10. 明确不做（YAGNI）

- 不抢默认程序、不改 `UserChoice`。
- 不做“取消关联 / 移除打开方式”的 UI（可后续单开）。
- 不做绿色包移动后的自动重注册。
- 不做 shell 扩展/右键菜单/缩略图预览。
- 不做非 Windows 平台的关联（mac/Linux 另说）。

## 11. 决策记录

- 只登记「打开方式」、不抢默认：用户明确。
- 首次运行弹窗询问：用户明确。
- 项目外文件自动以临时项目打开：用户明确。
- 扩展名集合（md/markdown/yaml/yml/js/mjs/cjs/json/http/rest/curl）：用户选定。
- 服务端内存临时项目（方案 A）而非写入 XML：避免污染配置。
