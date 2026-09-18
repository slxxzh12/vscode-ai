# 协作群成员「自己 / 群主」标识设计

## 背景

协作群里两个位置对成员身份的标识不一致：

- **右侧成员表**（`web/src/collaboration/MemberUsageTable.vue:36`）：群主行有 `👑 群主` 徽标，**自己没有标识**。
- **群聊消息**（`web/src/collaboration/GroupChatView.vue:124-129`）：自己的消息 `.who` 显示为「我」（不显示用户名），**群主没有标识**。

## 目标

在成员表和群聊消息两处，同时把「自己」和「群主」标识出来。

## 设计

### 1. 右侧成员表 `MemberUsageTable.vue`

- 新增 `const me = computed(() => snap.value.identity.machineId)`（`snap` 已存在）。
- 机器名单元格：在 `👑 群主` 徽标之后、`mname` 之前插入自己的徽标：

```html
<span v-if="row.machineId === me" class="mebadge">{{ $t('collab.member.me') }}</span>
```

- 样式：与 `.crown` 同形（`flex:none; margin-right:6px; padding:0 6px; border-radius:4px; font-size:11px; font-weight:700; line-height:18px; white-space:nowrap;`），配色 `background: var(--ac); color: var(--onac);`。

### 2. 群聊消息 `GroupChatView.vue`

- 新增 `const hubId = computed(() => group.value?.hubId || '')`。
- `.meta` 内 `.who` 改为始终显示用户名；其后追加两个徽标：

```html
<div class="meta">
  <span class="who">{{ nameOf(m.fromId) }}</span>
  <span v-if="m.fromId === hubId" class="tag master">{{ $t('collab.member.master') }}</span>
  <span v-if="isMine(m)" class="tag me">{{ $t('collab.chat.me') }}</span>
  <span class="time">{{ fmtTime(m.ts) }}</span>
  <span v-if="m.kind === 'system'" class="tag sys">{{ $t('collab.chat.system') }}</span>
</div>
```

- 样式：把现有 `.tag.sys` 拆出公共 `.tag` 基类，新增两色：

```css
.tag { padding: 0 6px; border-radius: 8px; font-size: 10px; }
.tag.sys { background: var(--bg5); color: var(--tx2); }
.tag.master { background: var(--warn); color: #fff; font-weight: 700; }
.tag.me { background: var(--ac); color: var(--onac); font-weight: 700; }
```

- 说明：`group.members` 始终包含自己（`server/collaboration/store.js:70` 建群即写入 self，加入时 push），故 `nameOf(m.fromId)` 能取到自己的用户名；取不到时按现有逻辑回退为 machineId 前 6 位。系统消息 `fromId` 也是真实成员，徽标同样适用。

### 3. i18n

`shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 同步新增：

| key | zh-CN | en |
| --- | --- | --- |
| `collab.member.me` | 我 | Me |

- 群主复用现有 `collab.member.master`（群主 / Master）。
- 自己复用现有 `collab.chat.me`（我 / Me）。

## 涉及文件

- `web/src/collaboration/MemberUsageTable.vue`
- `web/src/collaboration/GroupChatView.vue`
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- `web/src/collaboration/MemberUsageTable.test.ts`（补测试）
- `web/src/collaboration/GroupChatView.test.ts`（新增测试）

## 测试

- `MemberUsageTable.test.ts`：新增用例——`identity.machineId` 与某行 `machineId` 相同时，该行文本包含 `t('collab.member.me')`；群主行仍包含 `t('collab.member.master')`。
- `GroupChatView.test.ts`（新建）：构造含「自己」与「群主」两条消息的群，断言
  - 群主消息的 meta 含用户名与 `t('collab.member.master')`；
  - 自己消息的 meta 含用户名与 `t('collab.chat.me')`。

## 非目标

- 不改 @提及候选列表的标识。
- 不改消息气泡的左右对齐/配色（`.msg.mine` 逻辑保持）。
- 不改后端数据结构。
