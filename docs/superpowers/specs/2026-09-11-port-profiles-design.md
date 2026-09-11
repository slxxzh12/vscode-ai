# 设计文档：端口数据档案（Port Profiles）

日期：2026-09-11
分支：master
状态：待评审

## 1. 概述

当前服务所有数据都落在同一个用户数据目录（`%USERPROFILE%\.local\share\devflow`），而服务在端口被占用时会自动回退 `22222 → 33333 → 44444`。结果是**同一台机器上多个窗口/实例共享同一份数据**（项目、工作流、定时任务、协作身份与好友、技能、消息历史），互相串扰。

本设计引入**端口数据档案（Port Profile）**：

- 每个档案是一套**完全独立**的数据：身份、好友/群、技能、项目、工作流、定时任务、消息历史。
- 数据按档案隔离，落在 `devflow/ports/<profileId>/`。
- **监听端口与档案解耦**：在 33333 监听的窗口也可以加载 22222 的档案。
- 启动时若发现存在多份档案，**弹窗让用户选择**这次使用哪一份；选择按监听端口记忆，下次同端口自动沿用。

### 已与用户确认的约束

- 端口与档案**解耦**（监听端口 ≠ 数据档案端口）。
- **全部隔离**：协作身份、好友/群、技能、项目、工作流、定时任务、消息历史全部按档案隔离。
- 选择交互：**启动时**检测；多份档案时弹窗选择；单份自动使用；零份自动新建。
- 选择**按监听端口记忆**，下次同端口自动沿用。
- **运行中切换档案**为非目标（YAGNI），后续需要再加。

## 2. 范围与排除

**做：**
- `server/data-home.js`：新增端口档案目录解析（`ports/`、`ports-state.json`）。
- 新增 `server/workspace.js`：档案列表/解析/创建/迁移/选择记忆 + 按档案构建各数据模块的工厂。
- `server/index.js`：改为「先绑定端口 → 再解析档案 → 懒初始化数据模块」；新增 `/api/workspace/*` 路由；未就绪时业务 API 返回 409。
- `server/config.js`：`projects.json`/`workflows.json` 路径改为档案目录内。
- `server/message-history.js` 调用方：消息历史落盘改为档案目录内。
- `server/collaboration` 相关：identity/store/upload/download/skills 根改为档案目录内。
- 前端：`web/src/App.vue` 启动时先取工作区状态；需要选择时渲染档案选择弹窗。
- i18n：新增 workspace 相关中英文案。

**明确排除（非目标）：**
- 运行中切换档案。
- 档案加密/权限/多用户。
- 对已打开档案的跨进程并发写做互斥锁（沿用现有 tmp+rename 原子写即可）。
- 远程协作协议本身的改动（仅改变本地存储根）。

## 3. 数据结构

### 3.1 目录布局

```
%USERPROFILE%\.local\share\devflow\
  ports-state.json          # { version, byListenPort: { "22222": "22222", "33333": "33333" } }
  ports/
    <profileId>/
      profile.json          # { id, name, port, createdAt, lastUsedAt }
      projects.json
      workflows.json
      scheduler/            # tasks.json / runs.json / logs/
      collab/
        identity.json       # 每档案独立身份（独立 machineId / 公私钥）
        collab.json         # 好友/群/收件箱/命令
      upload/
      download/
      message-history.jsonc
      skills-opencode/      # 该档案默认协作技能根
```

- `<profileId>`：创建时以端口号字符串命名（如 `"22222"`），可重命名，需满足 `[A-Za-z0-9_-]+` 且唯一。
- 档案名默认「端口 <port>」，可在弹窗里显示与改名（改名非必需，先只读展示）。

### 3.2 `ports-state.json`

```jsonc
{
  "version": 1,
  "byListenPort": {
    "22222": "22222",
    "33333": "33333"
  }
}
```

- 原子写（写 `.tmp` 再 rename）。
- 键为**实际监听端口**，值为档案 id。
- 值指向的档案目录不存在时，视为「未映射」。

### 3.3 `profile.json`

```jsonc
{ "id": "22222", "name": "端口 22222", "port": 22222, "createdAt": 1789324800000, "lastUsedAt": 1789324800000 }
```

`createdAt` / `lastUsedAt` 为 epoch 毫秒。`lastUsedAt` 在每次激活该档案时更新。

## 4. 启动流程

```
启动
 │
 ├─ 解析环境/配置，得到候选端口 [PORT, 33333, 44444]
 │
 ├─ startListening(): 建 HTTP Server（dispatcher），按候选顺序绑定
 │       得到实际 listenPort（沿用现有 EADDRINUSE 回退）
 │
 ├─ resolveProfile(listenPort):
 │     ├─ DEVFLOW_NODE 已设 → 走旧的 nodes/<name> 机制（逃生通道，不进入档案系统）
 │     ├─ byListenPort[listenPort] 存在且档案目录存在 → 直接使用
 │     ├─ 扫描 ports/*：
 │     │     ├─ 0 份 → 自动新建档案（id=listenPort, name=端口 <port>）→ 记录映射 → 使用
 │     │     ├─ 1 份 → 使用并记录映射
 │     │     └─ ≥2 份 → 状态 = needs-selection（仅工作区 API + 静态页可用）
 │     └─ 迁移：首次且 ports/ 不存在、存在旧数据 → 迁移为档案 "22222" 后再按上面判断
 │
 ├─ 若 已确定档案：initWorkspace(profile) 构建数据模块 → ready
 └─ 若 needs-selection：等 POST /api/workspace/select | create → initWorkspace → ready
```

**关键：** HTTP/WS 服务先起；数据模块（`Projects`、`CollabEngine`、scheduler、message history 路径、`createHttpApi`）在档案确定后才构建。未 ready 时：

- `/api/workspace/*` 与静态资源正常。
- 其他 `/api/*` 返回 `409 { error: 'not-ready' }`。
- `/ws` 连接接受但发送 `{ type: 'not-ready' }`，前端不应在此阶段连接。

`DEVFLOW_NODE` 逃生通道：设了环境变量时，完全沿用现有 `nodes/<name>` 身份 + `nodes/<fp>` 状态逻辑，不读取也不写 `ports-state.json`。

## 5. 模块设计

### 5.1 `server/workspace.js`

纯逻辑 + 少量 fs，便于单测：

```js
export function profilesRoot(dataHome)                 // <root>/ports
export function stateFile(dataHome)                    // <root>/ports-state.json
export function readState(file)                        // -> { version, byListenPort }
export function writeState(file, state)                // 原子写
export function listProfiles(root)                     // -> ProfileMeta[]（读各 profile.json）
export function readProfile(root, id)                  // -> ProfileMeta | null
export function createProfile(root, { id, name, port })// 建目录 + profile.json + 子目录
export function touchProfile(root, id)                 // 更新 lastUsedAt
export function migrateLegacy(dataHome, id='22222')    // 旧数据 → ports/<id>（复制，不删）+ .migrated 标记
export function resolveProfile({ dataHome, listenPort }) // -> { status:'ready', profile } | { status:'select', profiles }
export function profilePaths(root, id)                 // -> { root, projectsFile, workflowsFile, schedulerDir,
                                                       //      collabDir, identityFile, storeFile, uploadDir,
                                                       //      downloadDir, historyFile, skillsRoot }
```

### 5.2 `server/index.js`

- 抽出 `buildWorkspace(paths)`：构建 `Projects`、`CollabEngine`/store/identity、scheduler、`createHttpApi`，返回一个 bundle，挂到模块级 `let ws = null`。
- HTTP dispatcher：
  1. `/api/workspace/*` → workspace 路由（始终可用）。
  2. `ws === null` → `409 not-ready`。
  3. 其余 → 现有路由（collab / scheduler / http-api / 静态）。
- WS gateway：`ws === null` 时连接后立即回 `not-ready` 并忽略后续输入；ready 后行为不变。
- `startListening()` 复用现有回退逻辑；把「初始化数据模块」从启动早期移到档案确定之后。
- 端口写入 `config/runtime-port.txt` 保留。

### 5.3 `server/config.js`

- `resolveFiles()` 改为接收档案路径（由 workspace 提供），不再直接在 dataHome 根上取 `projects.json`/`workflows.json`。
- 保留 `seedFromLegacy` 用于迁移阶段。

### 5.4 前端

- 新增 `web/src/useWorkspace.ts`：`state()` 拉取 `/api/workspace/state`；`select(id)`、`create(name)`。
- `App.vue` 挂载：
  - 先 `GET /api/workspace/state`。
  - `needSelect` → 渲染 `<WorkspacePicker>` 全屏遮罩，列出档案（名称/端口/最后使用时间/项目数）与「新建档案」；选完调用对应 API，成功后 `location.reload()`。
  - `ready` → 正常初始化连接（现有逻辑）。
- 新增 `web/src/components/WorkspacePicker.vue`。

## 6. API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workspace/state` | `{ ready, needSelect, listenPort, current?, profiles: [{id,name,port,lastUsedAt,projectCount}] }` |
| POST | `/api/workspace/select` | body `{ id }`；写映射 + 初始化；返回 `{ ok:true, profile }`；id 不存在返回 404 |
| POST | `/api/workspace/create` | body `{ name? }`；以当前 listenPort 为 id 建档案（冲突则加后缀）；写映射 + 初始化 |

未就绪时 `select/create` 成功后置 `ready` 并广播（可选：WS `workspace-ready`，客户端也可直接 reload）。

## 7. 迁移

首次运行（`ports/` 不存在）且检测到旧数据（根下 `projects.json`、`workflows.json`、`scheduler/`、`collab/`、`nodes/<fp>/message-history.jsonc` 任一存在）：

1. 创建档案 `22222`，把上述内容**复制**（不删除）到 `ports/22222/` 对应位置；旧 `nodes/<fp>/message-history.jsonc` 取最近修改的一份拷到 `ports/22222/message-history.jsonc`。
2. 生成 `ports/.migrated` 标记避免重复。
3. 迁移后 `ports/*` 至少一份 → 单份自动使用，不弹窗。

已有多份端口数据时，旧数据不参与（迁移只在 `ports/` 不存在时发生）。

## 8. 错误处理

- 映射指向缺失档案 → 视为未映射，按「0/1/N」重新判断。
- 档案 id 非法或已存在 → `create` 报 400/409。
- `ports-state.json` 解析失败 → 备份为 `ports-state.json.bad` 后重建空状态。
- 迁移中途失败 → 保留已复制内容与 `.migrated` 不写；下次重试（幂等：已存在文件跳过）。

## 9. 测试

- `server/test/workspace.test.js`（node:test）：
  - `resolveProfile`：0 份→新建；1 份→使用；≥2 份→select；映射命中→使用；映射指向缺失→重新判断。
  - `createProfile`：目录与 `profile.json` 生成、id 冲突处理。
  - `writeState`：原子写、坏文件重建。
  - `migrateLegacy`：复制旧数据、幂等、`.migrated` 标记。
- `server/test/http-api.test.js` 增补：`/api/workspace/state|select|create` 行为；未就绪时业务 API 返回 409。
- 现有 `projects/readText` 等测试改为传入档案路径。
- 手动：端口回退组合下的弹窗选择、单份自动、迁移。

## 10. 风险与权衡

- **index.js 重构面较大**：数据模块从"启动即建"改为"档案确定后建"。为控制风险，`buildWorkspace` 保持现有构造顺序，仅移动调用时机；先保证 ready 后行为与现状一致。
- **多进程并发写 `ports-state.json`**：原子写 + 最后写入胜出；冲突概率低，可接受。
- **同一档案被两窗口同时打开**：不互斥；沿用原子写，极端情况下可能互相覆盖（现有行为，非本次新增）。
- **旧数据误迁移**：只复制不移动，且仅在 `ports/` 不存在时发生，可回退。

## 11. 非目标

- 运行中切换档案（后续迭代）。
- 档案的重命名/删除 UI（先只读展示 + 新建）。
- 跨机器档案同步。
