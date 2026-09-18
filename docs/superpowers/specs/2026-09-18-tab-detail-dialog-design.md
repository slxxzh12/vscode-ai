# 设计文档：页签双击弹框（页签名 + 详细描述）与输入区黄色提示框

日期：2026-09-18
分支：master
状态：待评审

## 1. 概述

现有行为：双击会话页签头会内联改名（`TerminalView.vue` 的 `startRename` / `commitRename`），改名落地后会向 Agent 会话发送 `/rename` 同步会话名。

本改动把「双击页签头」的内联改名升级为一个弹框，弹框含两栏：

1. **页签名**：回写页签（沿用现有改名逻辑），并同步 Agent 会话名。
2. **详细描述**：仅作提示展示，跟随会话持久化。

用户确定弹框后，在 composer（输入区）中与「选择文件」按钮同一行，新增一个**黄色提示框**，展示当前会话的详细描述（只读、单行省略、hover 显示全文）。

## 2. 已与用户确认的约束

- 「详细描述」用途与保存：**仅作提示展示 + 跟随会话持久化**（刷新 / 重开实例后仍在）。
- 适用范围：**所有会话页签**（agent + shell）双击都弹框，**完全取代**原内联改名；shell 会话没有「同步 Agent 会话名」这一步。
- 黄色提示框长文本行为：**只读**，超出**截断 + hover tooltip 显示全文**，框内**不能清除**（要删描述须再双击页签在弹框里清空）。
- 无描述（或清空）时黄色提示框**不显示**。

## 3. 行为

### 3.1 打开弹框

- 双击任意会话页签（`t.kind === 'session'`，即 id 形如 `s:<sid>`）→ 打开弹框。
- 弹框打开时预填：
  - `页签名`：该会话当前的自定义名（`tabNames[sid]`）；无自定义名时留空，占位符显示默认名（`tabLabel(sid)`）。
  - `详细描述`：`tabDescs[sid]`，无则空。
- 记录被编辑的 `sid`（`dialogSid`），确定时据此落地。

### 3.2 确定（提交）

页签名（沿用现有 `commitRename` 逻辑，`name = 输入.trim()`）：

1. `next = { ...tabNames }`；`name` 非空则 `next[sid] = name`，否则 `delete next[sid]`；写回 `tabNames` 并 `persistTabNames()`。
2. `props.center.ensureSession(sid, tabLabel(sid), sessionState(sid))`。
3. `msgHistory.renameTab(sid, tabLabel(sid))`（同步历史消息里记录的页签名）。
4. `name` 非空时调用现有 `syncAgentRename(sid, name)`（仅 agent 且在运行的会话会真正发送 `/rename`；shell 跳过）。

详细描述（`desc = 输入.trim()`）：

1. `next = { ...tabDescs }`；`desc` 非空则 `next[sid] = desc`，否则 `delete next[sid]`；写回 `tabDescs` 并 `persistTabDescs()`。

关闭弹框。

### 3.3 取消 / 快捷键

- `取消` 或 Esc → 关闭弹框，不改任何状态。
- 页签名输入框回车 → 提交（等同「确定」）。
- 详细描述是多行 textarea，回车**换行**，不提交。

### 3.4 黄色提示框

- 位置：composer 的 `.ctools` 行（与 `term.pick_file`「选择文件」按钮同一行），置于该行按钮组的左侧。
- 内容：当前活动会话的 `tabDescs[sid]`。
- 样式：黄色 warn 体系（`var(--warn2)`，与 `wfbtn.edit` 一致），只读。
- 展示：单行、`text-overflow: ellipsis`；`title` 属性 = 完整描述（hover tooltip）；`max-width` 受限，避免挤掉右侧按钮。
- 无描述时整个框不渲染（`v-if`）。

## 4. 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `web/src/components/TabRenameDialog.vue` | 弹框组件：两栏输入 + 取消/确定；emit `confirm({ name, description })` / `cancel` | Create |
| `web/src/components/TerminalView.vue` | 持有弹框状态与 `tabDescs` 持久化；替换内联改名；渲染黄色提示框 | Modify |
| `shared/i18n/zh-CN.js` / `shared/i18n/en.js` | 新增弹框与提示框词条（中英对称） | Modify |
| `web/src/components/TabRenameDialog.test.ts` | vitest 组件测试（或抽纯函数测试） | Create |

`TerminalView.vue` 已 1313 行，故弹框抽为独立组件（符合项目「独立功能独立文件」约定）。

### 4.1 组件接口

```ts
// web/src/components/TabRenameDialog.vue
props: {
  name: string;         // 预填页签名（可为空）
  description: string;  // 预填详细描述（可为空）
  placeholder: string;  // 页签名占位符（默认名）
}
emits: {
  confirm: [{ name: string; description: string }];  // 已 trim
  cancel: [];
}
```

### 4.2 TerminalView 新增状态

```ts
const tabDescs = ref<Record<string, string>>({});   // 与 tabNames 平行
let tabDescsKey = 'devflow-tab-descs-none';
function loadTabDescs() { /* 同 loadTabNames 的容错读取 */ }
function persistTabDescs() { /* 同 persistTabNames */ }

const dialogSid = ref<string | null>(null);
const dialogName = ref('');
const dialogDesc = ref('');
function openTabDialog(tabId: string) { /* 设置 dialogSid/dialogName/dialogDesc */ }
function onTabDialogConfirm({ name, description }: { name: string; description: string }) { /* 3.2 逻辑 */ }
function onTabDialogCancel() { dialogSid.value = null; }
```

初始化时（`onMounted` 内 `tabNamesKey` 赋值处）同步设置 `tabDescsKey = \`devflow-tab-descs-${fp}\`` 并 `loadTabDescs()`。

## 5. 边界与取舍

- 描述只按 `sid` 存 localStorage，不跨设备同步（与 `tabNames` 一致）。
- 页签关闭后描述条目保留（与 `tabNames` 现状一致，不做清理）；`sid` 一般不复用，视为可接受。
- 黄色提示框只在会话视图显示（composer 存在时）；文件预览页签无 composer，自然不显示。
- 手机模式（`props.phone`）沿用同一逻辑；如无页签头双击入口则不触发弹框，提示框仍按会话显示。

## 6. 测试与验收

- 单测（vitest）：
  - 弹框提交：输入名/描述带空白 → `confirm` 事件值为 trim 后的结果。
  - 取消：`cancel` 事件触发，无 `confirm`。
- 类型检查：`npm.cmd run typecheck` 通过。
- i18n：`npm.cmd run check:i18n` 通过；中英词条键集合对称。
- 全量：`npm.cmd test` 通过。
- 构建：`npm.cmd run build:web` 通过。
- 人工验收：
  1. 双击任意会话页签 → 弹框；填名 + 描述 → 确定 → 页签名更新、agent 会话名同步、composer 该行出现黄色提示框。
  2. hover 黄色提示框 → 显示完整描述。
  3. 刷新页面 → 页签名与黄色提示框仍在。
  4. 再双击 → 两栏预填；清空描述 → 确定 → 黄色提示框消失。

## 7. 明确不做

- 不把描述拼进发送的提示词（仅展示）。
- 不提供黄色提示框内编辑 / 一键清除。
- 不做描述的服务端持久化 / 跨设备同步。
- 不改 WS 协议与后端。

## 8. 决策记录

- 「仅提示 + 持久化」：用户在四选项中选 1。
- 「所有会话页签弹框、取代内联改名」：用户选 1。
- 「只读 + 截断 + tooltip、框内不可清除」：用户选 2。
- 弹框抽独立组件：`TerminalView.vue` 已过大，符合项目目录组织约定。
