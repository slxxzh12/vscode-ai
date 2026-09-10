# i18n Web 迁移：协作区（里程碑 2a）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `web/src/collaboration/**` 与相关 API 文件中的用户可见中文全部替换为 `$t()`/`t()`，补齐中英词条。

**Architecture:** 复用里程碑 1 的 `shared/i18n` 与 `web/src/i18n.ts`（`$t` 全局属性）。词条统一追加到 `shared/i18n/zh-CN.js` 与 `en.js`。每个文件改完用 `npm run check:i18n` 确认该文件零命中。

**Tech Stack:** Vue 3 setup + TS、vitest、`node scripts/check-i18n.js`。

**前置:** 里程碑 1 已合并（`shared/i18n`、`web/src/i18n.ts`、`$t`、`check:i18n`）。

**范围文件:** `CollaborationView.vue`、`ContactsView.vue`、`GroupChatView.vue`、`JoinInviteCard.vue`、`SkillDistributor.vue`、`TasksView.vue`、`useCollab.ts`。

---

## 约定

- 模板用 `$t('key')`；`<script setup>` 内用 `t('key')`（先 `import { t } from '../i18n';`，若该文件尚无 i18n 引入）。
- 带参数用 `t('key', { name, count })`；词条用 `{name}` 占位。
- 纯符号/品牌词（`opencode`/`claudecode`/`command`/`agent`/`skills`）保留；只有中文才提取。
- 每完成一个文件：`npm.cmd run check:i18n` 中该文件不再出现，即通过。

---

## Task 1: 追加 `common.*` 与 `collab.*` 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 在 `zh-CN.js` 的 `messages` 中追加**

```js
  'common.accept': '接受',
  'common.reject': '拒绝',
  'common.delete': '删除',
  'common.copy': '复制',
  'common.invite': '邀请',
  'common.send': '发送',
  'common.sending': '发送中…',
  'common.packing': '打包中…',
  'common.processing': '处理中…',
  'common.join': '加入',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.allow': '允许',
  'common.save': '保存',
  'common.send_failed': '发送失败：{msg}',
  'common.download_failed': '下载失败：{msg}',
  'collab.tabs.contacts': '联系人',
  'collab.tabs.tasks': '任务',
  'collab.title': '👥 通讯录',
  'collab.pending': '待处理',
  'collab.add': '添加',
  'collab.placeholder': '选择左侧好友或群组开始吧',
  'collab.role.owner': '群主',
  'collab.role.admin': '管理员',
  'collab.role.member': '成员',
  'collab.group.name_placeholder': '建群名称',
  'collab.group.create': '建群',
  'collab.group.create_short': '＋群',
  'collab.group.mine': '我的群（{count}）',
  'collab.group.empty': '还没有群，创建或等邀请吧',
  'collab.group.avatar': '群',
  'collab.group.member_count': '{count} 人',
  'collab.group.members': '成员 {count}',
  'collab.group.invite_placeholder': '成员 machineId，回车邀请',
  'collab.group.invite': '邀请入群',
  'collab.group.invited_you': '邀你入群',
  'collab.group.invite_suffix': '',
  'collab.group.kick': '踢出',
  'collab.group.kick_title': '移出群',
  'collab.group.kick_confirm': '把 {name} 移出群？',
  'collab.group.dissolve': '解散群',
  'collab.group.dissolve_confirm': '解散群「{name}」？',
  'collab.group.me_suffix': '（我）',
  'collab.friend.host_placeholder': '好友 IP',
  'collab.friend.port_placeholder': '端口',
  'collab.friend.add': '加好友',
  'collab.friend.add_short': '＋友',
  'collab.friend.mine': '我的好友（{count}）',
  'collab.friend.empty': '暂无，输入对方 IP:端口 添加',
  'collab.friend.remove': '删除好友',
  'collab.friend.remove_confirm': '删除好友？',
  'collab.friend.address': '地址',
  'collab.friend.fingerprint': '公钥指纹',
  'collab.friend.invite_to_group': '拉入群',
  'collab.friend.no_group': '还没有群可拉入',
  'collab.invite.paste_placeholder': '粘贴邀请链接/邀请码',
  'collab.invite.preview': '预览',
  'collab.invite.preview_title': '预览邀请',
  'collab.invite.generate': '生成邀请链接',
  'collab.invite.reset': '重置链接',
  'collab.invite.reset_confirm': '重置邀请链接？旧链接将立即失效',
  'collab.allow.title': '本机免确认命令（白名单）',
  'collab.allow.placeholder': '如 deploy / git status',
  'collab.allow.empty': '无，收到的远程执行都会要求确认',
  'collab.chat.file_sent': '已发送文件：{name}',
  'collab.chat.need_mention': '先 @ 一个群成员再发命令',
  'collab.chat.distribute': '🛠 分发技能',
  'collab.chat.distribute_title': '把本机技能分发给该群所有成员',
  'collab.chat.send_file': '📎 发文件',
  'collab.chat.file_title': '把本机文件发送给该群所有成员（≤40MB）',
  'collab.chat.cmd_request': '@{name} 请求在你这执行：',
  'collab.chat.me': '我',
  'collab.chat.system': '系统',
  'collab.chat.result': '执行结果',
  'collab.chat.exit_code': '退出码 {code}',
  'collab.chat.empty': '还没有消息',
  'collab.chat.no_match': '无匹配成员',
  'collab.chat.input_placeholder': '输入消息；@ 选择成员；/command 触发远程执行',
  'collab.join.expired': '邀请链接已过期',
  'collab.join.invalid': '邀请码无效或已损坏',
  'collab.join.revoked': '邀请链接已失效',
  'collab.join.no_group': '该群已不存在',
  'collab.join.bad_token': '邀请码无效',
  'collab.join.unreachable': '无法连接邀请方，可能不在线',
  'collab.join.title': '入群邀请',
  'collab.join.loading': '正在读取邀请…',
  'collab.join.inviter': '邀请人：',
  'collab.join.expires': '有效期至：',
  'collab.join.already': '你已在该群',
  'collab.join.open': '打开群',
  'collab.join.unreadable': '无法读取邀请',
  'collab.dist.select_first': '请先勾选 skills/command/agents',
  'collab.dist.packed': '打包完成',
  'collab.dist.sent': '已发送到 {count} 个成员',
  'collab.dist.sent_fail': '，失败 {n}',
  'collab.dist.title': '🛠 分发配置',
  'collab.dist.none': '全不选',
  'collab.dist.all': '全选',
  'collab.dist.skill_root': '技能根：',
  'collab.dist.skill_root_hint': '（command/agent 取同配置根；「任务」页可切工具）',
  'collab.dist.empty': '所选工具目录下暂无 skills/command/agent 可分发',
  'collab.dist.skills': '技能 skills/（{count}）',
  'collab.dist.command': '命令 command/（{count}）',
  'collab.dist.agent': '代理 agent/（{count}）',
  'collab.dist.pack': '① 打包（{count}）',
  'collab.dist.send': '② 发送到本群',
  'collab.dist.sent_ok': '✓ 已发送',
  'collab.dist.download': '下载包',
  'collab.dist.repack': '重新打包',
  'collab.dist.package': '包：',
  'collab.tool.mine': '我的开发工具',
  'collab.tool.custom': '自定义',
  'collab.tool.custom_path': '自定义路径',
  'collab.tool.custom_placeholder': 'skills 目录绝对路径',
  'collab.tool.switched': '已切换到 {tool}（{root}）',
  'collab.task.install_confirm': 'skill 含未知脚本，将安装到所选开发工具的 skills 目录。确认？',
  'collab.task.remove_confirm': '删除该任务？',
  'collab.task.remove_out_confirm': '删除该任务并清掉 upload 留档？',
  'collab.task.install_hint': '技能安装到：{root}，重启对应 CLI 生效',
  'collab.task.download_dir': '接收目录',
  'collab.task.upload_dir': '发出目录',
  'collab.task.empty': '暂无任务（群内「📎 发文件 / 🛠 分发技能」会生成这里与对方）',
  'collab.task.inbound': '收到（{count}）',
  'collab.task.outbound': '发出（{count}）',
  'collab.task.kind.file': '文件',
  'collab.task.kind.skill': '技能',
  'collab.task.unknown_group': '未知群',
  'collab.task.install': '安装',
  'collab.task.ignore': '忽略',
  'collab.task.download': '下载',
  'collab.task.installed': '已安装·重启生效',
  'collab.task.installed_at': '已装到 {root}',
  'collab.task.ignored': '已忽略',
  'collab.task.invalid': '无效包',
  'collab.file.too_large': '文件超过 40MB 上限',
```

- [ ] **Step 2: 在 `en.js` 追加同键英文**

```js
  'common.accept': 'Accept',
  'common.reject': 'Reject',
  'common.delete': 'Delete',
  'common.copy': 'Copy',
  'common.invite': 'Invite',
  'common.send': 'Send',
  'common.sending': 'Sending…',
  'common.packing': 'Packing…',
  'common.processing': 'Processing…',
  'common.join': 'Join',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.allow': 'Allow',
  'common.save': 'Save',
  'common.send_failed': 'Send failed: {msg}',
  'common.download_failed': 'Download failed: {msg}',
  'collab.tabs.contacts': 'Contacts',
  'collab.tabs.tasks': 'Tasks',
  'collab.title': '👥 Contacts',
  'collab.pending': 'Pending',
  'collab.add': 'Add',
  'collab.placeholder': 'Select a friend or group on the left',
  'collab.role.owner': 'Owner',
  'collab.role.admin': 'Admin',
  'collab.role.member': 'Member',
  'collab.group.name_placeholder': 'Group name',
  'collab.group.create': 'Create group',
  'collab.group.create_short': '＋Group',
  'collab.group.mine': 'My groups ({count})',
  'collab.group.empty': 'No groups yet. Create one or wait for an invite',
  'collab.group.avatar': 'G',
  'collab.group.member_count': '{count} members',
  'collab.group.members': 'Members {count}',
  'collab.group.invite_placeholder': 'Member machineId, press Enter to invite',
  'collab.group.invite': 'Invite to group',
  'collab.group.invited_you': 'invited you to join',
  'collab.group.invite_suffix': '',
  'collab.group.kick': 'Kick',
  'collab.group.kick_title': 'Remove from group',
  'collab.group.kick_confirm': 'Remove {name} from the group?',
  'collab.group.dissolve': 'Dissolve group',
  'collab.group.dissolve_confirm': 'Dissolve group "{name}"?',
  'collab.group.me_suffix': ' (me)',
  'collab.friend.host_placeholder': 'Friend IP',
  'collab.friend.port_placeholder': 'Port',
  'collab.friend.add': 'Add friend',
  'collab.friend.add_short': '＋Friend',
  'collab.friend.mine': 'My friends ({count})',
  'collab.friend.empty': "None yet. Add by entering the other side's IP:port",
  'collab.friend.remove': 'Remove friend',
  'collab.friend.remove_confirm': 'Remove friend?',
  'collab.friend.address': 'Address',
  'collab.friend.fingerprint': 'Public key fingerprint',
  'collab.friend.invite_to_group': 'Invite to group',
  'collab.friend.no_group': 'No groups to invite into',
  'collab.invite.paste_placeholder': 'Paste invite link/code',
  'collab.invite.preview': 'Preview',
  'collab.invite.preview_title': 'Preview invite',
  'collab.invite.generate': 'Generate invite link',
  'collab.invite.reset': 'Reset link',
  'collab.invite.reset_confirm': 'Reset invite link? Old links will stop working immediately',
  'collab.allow.title': 'Auto-approved local commands (allowlist)',
  'collab.allow.placeholder': 'e.g. deploy / git status',
  'collab.allow.empty': 'None. Incoming remote commands will require confirmation',
  'collab.chat.file_sent': 'File sent: {name}',
  'collab.chat.need_mention': 'Mention a group member before sending a command',
  'collab.chat.distribute': '🛠 Distribute skills',
  'collab.chat.distribute_title': 'Distribute local skills to all group members',
  'collab.chat.send_file': '📎 Send file',
  'collab.chat.file_title': 'Send local files to all group members (≤40MB)',
  'collab.chat.cmd_request': '@{name} requests execution on your machine:',
  'collab.chat.me': 'Me',
  'collab.chat.system': 'System',
  'collab.chat.result': 'Result',
  'collab.chat.exit_code': 'exit {code}',
  'collab.chat.empty': 'No messages yet',
  'collab.chat.no_match': 'No matching members',
  'collab.chat.input_placeholder': 'Type a message; @ to mention; /command to run remotely',
  'collab.join.expired': 'Invite link has expired',
  'collab.join.invalid': 'Invite code is invalid or corrupted',
  'collab.join.revoked': 'Invite link is no longer valid',
  'collab.join.no_group': 'This group no longer exists',
  'collab.join.bad_token': 'Invalid invite code',
  'collab.join.unreachable': 'Cannot reach the inviter; they may be offline',
  'collab.join.title': 'Group invite',
  'collab.join.loading': 'Reading invite…',
  'collab.join.inviter': 'Inviter:',
  'collab.join.expires': 'Valid until:',
  'collab.join.already': 'You are already in this group',
  'collab.join.open': 'Open group',
  'collab.join.unreadable': 'Unable to read invite',
  'collab.dist.select_first': 'Select skills/command/agents first',
  'collab.dist.packed': 'Packed',
  'collab.dist.sent': 'Sent to {count} members',
  'collab.dist.sent_fail': ', {n} failed',
  'collab.dist.title': '🛠 Distribution',
  'collab.dist.none': 'Deselect all',
  'collab.dist.all': 'Select all',
  'collab.dist.skill_root': 'Skill root:',
  'collab.dist.skill_root_hint': '(command/agent use the same config root; switch tool on the Tasks tab)',
  'collab.dist.empty': 'No skills/command/agent to distribute under the selected tool directory',
  'collab.dist.skills': 'Skills skills/ ({count})',
  'collab.dist.command': 'Commands command/ ({count})',
  'collab.dist.agent': 'Agents agent/ ({count})',
  'collab.dist.pack': '① Pack ({count})',
  'collab.dist.send': '② Send to group',
  'collab.dist.sent_ok': '✓ Sent',
  'collab.dist.download': 'Download',
  'collab.dist.repack': 'Repack',
  'collab.dist.package': 'Package:',
  'collab.tool.mine': 'My dev tool',
  'collab.tool.custom': 'Custom',
  'collab.tool.custom_path': 'Custom path',
  'collab.tool.custom_placeholder': 'Absolute path to skills directory',
  'collab.tool.switched': 'Switched to {tool} ({root})',
  'collab.task.install_confirm': "This skill contains unknown scripts and will be installed into the selected tool's skills directory. Continue?",
  'collab.task.remove_confirm': 'Delete this task?',
  'collab.task.remove_out_confirm': 'Delete this task and its upload archive?',
  'collab.task.install_hint': 'Skills install to: {root}; restart the CLI to take effect',
  'collab.task.download_dir': 'Download dir',
  'collab.task.upload_dir': 'Upload dir',
  'collab.task.empty': 'No tasks yet (sending files / distributing skills in a group creates entries here and on peers)',
  'collab.task.inbound': 'Received ({count})',
  'collab.task.outbound': 'Sent ({count})',
  'collab.task.kind.file': 'File',
  'collab.task.kind.skill': 'Skill',
  'collab.task.unknown_group': 'Unknown group',
  'collab.task.install': 'Install',
  'collab.task.ignore': 'Ignore',
  'collab.task.download': 'Download',
  'collab.task.installed': 'Installed · restart to apply',
  'collab.task.installed_at': 'Installed at {root}',
  'collab.task.ignored': 'Ignored',
  'collab.task.invalid': 'Invalid package',
  'collab.file.too_large': 'File exceeds the 40MB limit',
```

- [ ] **Step 3: 运行 shared 测试确认未破坏**

Run: `node --test "server/test/i18n.test.js"`
Expected: PASS

- [ ] **Step 4: Commit**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m 'feat(i18n): 追加协作区中英词条'
```

---

## Task 2: `CollaborationView.vue`

**Files:** Modify `web/src/collaboration/CollaborationView.vue`

- [ ] **Step 1: 替换**
  - `{ id: 'contacts' as const, label: '联系人' }` → `label: \`${'$'}{$t('collab.tabs.contacts')}\`` **不可行**（label 在 script 数组里）。改为在 `tabs` 定义处用 `t()`：文件顶部 `import { t } from '../i18n';`，`label: t('collab.tabs.contacts')`、`label: t('collab.tabs.tasks')`。若 `tabs` 为模块级常量且需响应语言切换，改为 `computed(() => [...])`。（现状 `tabs` 为普通数组，需改 `computed`。）
  - 模板 `<span class="title">👥 通讯录</span>` → `<span class="title">{{ $t('collab.title') }}</span>`

- [ ] **Step 2: 验证**

Run: `npm.cmd run typecheck`
Run: `node scripts/check-i18n.js` → 该文件无命中

- [ ] **Step 3: Commit**

```powershell
git add web/src/collaboration/CollaborationView.vue
git commit -m 'feat(i18n): CollaborationView 文案迁移'
```

---

## Task 3: `ContactsView.vue`

**Files:** Modify `web/src/collaboration/ContactsView.vue`

- [ ] **Step 1: 在 `<script setup>` 顶部加 `import { t } from '../i18n';`（模板已有 `$t`）。**
- [ ] **Step 2: 按 literal → key 替换（模板 `$t`，script `t`）：**

| literal | 替换 |
|---|---|
| `roleLabel` 返回 `'群主'/'管理员'/'成员'` | `t('collab.role.owner')` / `t('collab.role.admin')` / `t('collab.role.member')` |
| `` `把 ${m.username} 移出群？` `` | `t('collab.group.kick_confirm', { name: m.username })` |
| `` `解散群「${g.name}」？` `` | `t('collab.group.dissolve_confirm', { name: g.name })` |
| `'重置邀请链接？旧链接将立即失效'` | `t('collab.invite.reset_confirm')` |
| `'删除好友？'` | `t('collab.friend.remove_confirm')` |
| `待处理` | `$t('collab.pending')` |
| `邀你入群` | `$t('collab.group.invited_you')` |
| `接受` | `$t('common.accept')`（两处） |
| `拒绝` | `$t('common.reject')`（两处） |
| `添加` | `$t('collab.add')` |
| `placeholder="建群名称"` | `:placeholder="$t('collab.group.name_placeholder')"` |
| `title="建群"` `＋群` | `:title="$t('collab.group.create')"` `{{ $t('collab.group.create_short') }}` |
| `placeholder="好友 IP"` | `:placeholder="$t('collab.friend.host_placeholder')"` |
| `placeholder="端口"` | `:placeholder="$t('collab.friend.port_placeholder')"` |
| `title="加好友"` `＋友` | `:title="$t('collab.friend.add')"` `{{ $t('collab.friend.add_short') }}` |
| `placeholder="粘贴邀请链接/邀请码"` | `:placeholder="$t('collab.invite.paste_placeholder')"` |
| `title="预览邀请"` `预览` | `:title="$t('collab.invite.preview_title')"` `{{ $t('collab.invite.preview') }}` |
| `我的好友（{{ friends.length }}）` | `{{ $t('collab.friend.mine', { count: friends.length }) }}` |
| `暂无，输入对方 IP:端口 添加` | `{{ $t('collab.friend.empty') }}` |
| `我的群（{{ groups.length }}）` | `{{ $t('collab.group.mine', { count: groups.length }) }}` |
| `还没有群，创建或等邀请吧` | `{{ $t('collab.group.empty') }}` |
| `g.name.trim().charAt(0) \|\| '群'` | `g.name.trim().charAt(0) \|\| $t('collab.group.avatar')` |
| `{{ g.members.length }} 人` | `{{ $t('collab.group.member_count', { count: g.members.length }) }}` |
| `本机免确认命令（白名单）` | `{{ $t('collab.allow.title') }}` |
| `placeholder="如 deploy / git status"` | `:placeholder="$t('collab.allow.placeholder')"` |
| `无，收到的远程执行都会要求确认` | `{{ $t('collab.allow.empty') }}` |
| `删除`（白名单行） | `{{ $t('common.delete') }}` |
| `解散群` | `{{ $t('collab.group.dissolve') }}` |
| `成员 {{ activeGroup.members.length }}` | `{{ $t('collab.group.members', { count: activeGroup.members.length }) }}` |
| `placeholder="成员 machineId，回车邀请"` | `:placeholder="$t('collab.group.invite_placeholder')"` |
| `title="邀请入群"` | `:title="$t('collab.group.invite')"` |
| `生成邀请链接` | `{{ $t('collab.invite.generate') }}` |
| `复制` | `{{ $t('common.copy') }}` |
| `重置链接` | `{{ $t('collab.invite.reset') }}` |
| `（我）` | `{{ $t('collab.group.me_suffix') }}` |
| `title="移出群"` `踢出` | `:title="$t('collab.group.kick_title')"` `{{ $t('collab.group.kick') }}` |
| `删除好友` | `{{ $t('collab.friend.remove') }}` |
| `地址` | `{{ $t('collab.friend.address') }}` |
| `公钥指纹` | `{{ $t('collab.friend.fingerprint') }}` |
| `拉入群` | `{{ $t('collab.friend.invite_to_group') }}` |
| `邀请` | `{{ $t('common.invite') }}` |
| `还没有群可拉入` | `{{ $t('collab.friend.no_group') }}` |
| `选择左侧好友或群组开始吧` | `{{ $t('collab.placeholder') }}` |

- [ ] **Step 3: 验证**：`npm.cmd run typecheck` + `node scripts/check-i18n.js`（该文件零命中）
- [ ] **Step 4: Commit** `feat(i18n): ContactsView 文案迁移`

---

## Task 4: `GroupChatView.vue`

**Files:** Modify `web/src/collaboration/GroupChatView.vue`

- [ ] **Step 1: script 内加 `import { t } from '../i18n';`。**
- [ ] **Step 2: 替换：**

| literal | 替换 |
|---|---|
| `` `已发送文件：${f.name}` `` | `t('collab.chat.file_sent', { name: f.name })` |
| `` `发送失败：${err?.message || err}` `` | `t('common.send_failed', { msg: err?.message || err })` |
| `alert('先 @ 一个群成员再发命令')` | `alert(t('collab.chat.need_mention'))` |
| `title="把本机技能分发给该群所有成员"` `🛠 分发技能` | `:title="$t('collab.chat.distribute_title')"` `{{ $t('collab.chat.distribute') }}` |
| `title="把本机文件发送给该群所有成员（≤40MB）"` `发送中…` `📎 发文件` | `:title="$t('collab.chat.file_title')"` `{{ $t('common.sending') }}` `{{ $t('collab.chat.send_file') }}` |
| `@{{ nameOf(p.fromId) }} 请求在你这执行：` | `{{ $t('collab.chat.cmd_request', { name: nameOf(p.fromId) }) }}` |
| `允许` | `{{ $t('common.allow') }}` |
| `拒绝` | `{{ $t('common.reject') }}` |
| `我`（who） | `{{ $t('collab.chat.me') }}` |
| `系统` | `{{ $t('collab.chat.system') }}` |
| `执行结果` `退出码 {{ m.meta.exitCode ?? '-' }}` | `{{ $t('collab.chat.result') }}` `{{ $t('collab.chat.exit_code', { code: m.meta.exitCode ?? '-' }) }}` |
| `还没有消息` | `{{ $t('collab.chat.empty') }}` |
| `无匹配成员` | `{{ $t('collab.chat.no_match') }}` |
| `placeholder="输入消息；@ 选择成员；/command 触发远程执行"` | `:placeholder="$t('collab.chat.input_placeholder')"` |
| `发送` | `{{ $t('common.send') }}` |

- [ ] **Step 3: 验证** + **Step 4: Commit** `feat(i18n): GroupChatView 文案迁移`

---

## Task 5: `JoinInviteCard.vue`

**Files:** Modify `web/src/collaboration/JoinInviteCard.vue`

- [ ] **Step 1: script 加 `import { t } from '../i18n';`，替换错误文案：**
  - `load()`：`r.code === 'expired' ? t('collab.join.expired') : t('collab.join.invalid')`
  - `joinErrorText` 映射：`expired→collab.join.expired`、`invite-revoked→collab.join.revoked`、`no-group→collab.join.no_group`、`bad-token→collab.join.bad_token`、默认 `collab.join.unreachable`
- [ ] **Step 2: 模板替换：**

| literal | 替换 |
|---|---|
| `入群邀请` | `{{ $t('collab.join.title') }}` |
| `正在读取邀请…` | `{{ $t('collab.join.loading') }}` |
| `邀请人：` | `{{ $t('collab.join.inviter') }}` |
| `有效期至：` | `{{ $t('collab.join.expires') }}` |
| `你已在该群` | `{{ $t('collab.join.already') }}` |
| `处理中…` `打开群` `加入` | `{{ $t('common.processing') }}` `{{ $t('collab.join.open') }}` `{{ $t('common.join') }}` |
| `取消` | `{{ $t('common.cancel') }}` |
| `无法读取邀请` | `{{ $t('collab.join.unreadable') }}` |
| `关闭` | `{{ $t('common.close') }}` |

- [ ] **Step 3: 验证** + **Step 4: Commit** `feat(i18n): JoinInviteCard 文案迁移`

---

## Task 6: `SkillDistributor.vue`

**Files:** Modify `web/src/collaboration/SkillDistributor.vue`

- [ ] **Step 1: script 加 `import { t } from '../i18n';`，替换：**
  - `'请先勾选 skills/command/agents'` → `t('collab.dist.select_first')`
  - `'打包完成'` → `t('collab.dist.packed')`
  - `` `发送失败：${r.code}` `` → `t('common.send_failed', { msg: r.code })`
  - `` `已发送到 ${r.pushed} 个成员${r.failures?.length ? `，失败 ${r.failures.length}` : ''}` `` → `t('collab.dist.sent', { count: r.pushed }) + (r.failures?.length ? t('collab.dist.sent_fail', { n: r.failures.length }) : '')`
  - `` `下载失败：${e?.message || e}` `` → `t('common.download_failed', { msg: e?.message || e })`
- [ ] **Step 2: 模板替换：**

| literal | 替换 |
|---|---|
| `🛠 分发配置` | `{{ $t('collab.dist.title') }}` |
| `全不选` / `全选` | `{{ $t('collab.dist.none') }}` / `{{ $t('collab.dist.all') }}` |
| `技能根：` | `{{ $t('collab.dist.skill_root') }}` |
| `（command/agent 取同配置根；「任务」页可切工具）` | `{{ $t('collab.dist.skill_root_hint') }}` |
| `所选工具目录下暂无 skills/command/agent 可分发` | `{{ $t('collab.dist.empty') }}` |
| `技能 skills/（{{ assets.skills.length }}）` | `{{ $t('collab.dist.skills', { count: assets.skills.length }) }}` |
| `命令 command/（{{ assets.command.length }}）` | `{{ $t('collab.dist.command', { count: assets.command.length }) }}` |
| `代理 agent/（{{ assets.agent.length }}）` | `{{ $t('collab.dist.agent', { count: assets.agent.length }) }}` |
| `打包中…` `① 打包（{{ selectedCount }}）` | `{{ $t('common.packing') }}` `{{ $t('collab.dist.pack', { count: selectedCount }) }}` |
| `发送中…` `✓ 已发送` `② 发送到本群` | `{{ $t('common.sending') }}` `{{ $t('collab.dist.sent_ok') }}` `{{ $t('collab.dist.send') }}` |
| `下载包` | `{{ $t('collab.dist.download') }}` |
| `重新打包` | `{{ $t('collab.dist.repack') }}` |
| `包：` | `{{ $t('collab.dist.package') }}` |

- [ ] **Step 3: 验证** + **Step 4: Commit** `feat(i18n): SkillDistributor 文案迁移`

---

## Task 7: `TasksView.vue`

**Files:** Modify `web/src/collaboration/TasksView.vue`

- [ ] **Step 1: script 加 `import { t } from '../i18n';`，替换：**
  - `` `已切换到 ${toolKind.value === 'claudecode' ? 'claudecode' : toolKind.value === 'custom' ? '自定义' : 'opencode'}（${r.root}）` `` → 用 `toolLabel` 辅助：`const toolLabel = (k) => k === 'custom' ? t('collab.tool.custom') : k;` 然后 `t('collab.tool.switched', { tool: toolLabel(toolKind.value), root: r.root })`
  - `confirm('skill 含未知脚本，将安装到所选开发工具的 skills 目录。确认？')` → `confirm(t('collab.task.install_confirm'))`
  - `confirm('删除该任务？')` → `confirm(t('collab.task.remove_confirm'))`
  - `confirm('删除该任务并清掉 upload 留档？')` → `confirm(t('collab.task.remove_out_confirm'))`
  - `` `下载失败：${e?.message || e}` ``（alert） → `alert(t('common.download_failed', { msg: e?.message || e }))`
- [ ] **Step 2: 模板替换：**

| literal | 替换 |
|---|---|
| `我的开发工具` | `{{ $t('collab.tool.mine') }}` |
| `自定义`（下拉显示） | `{{ $t('collab.tool.custom') }}` |
| `自定义路径`（option） | `{{ $t('collab.tool.custom_path') }}` |
| `placeholder="skills 目录绝对路径"` | `:placeholder="$t('collab.tool.custom_placeholder')"` |
| `保存` | `{{ $t('common.save') }}` |
| `取消` | `{{ $t('common.cancel') }}` |
| `技能安装到：<code>{{ activeRoot }}</code>，重启对应 CLI 生效` | `{{ $t('collab.task.install_hint', { root: activeRoot }) }}`（去掉内层 `<code>`，或保留并拆分键；此处直接整体文案） |
| `title="接收目录"` | `:title="$t('collab.task.download_dir')"` |
| `title="发出目录"` | `:title="$t('collab.task.upload_dir')"` |
| `暂无任务（群内「📎 发文件 / 🛠 分发技能」会生成这里与对方）` | `{{ $t('collab.task.empty') }}` |
| `收到（{{ inbound.length }}）` | `{{ $t('collab.task.inbound', { count: inbound.length }) }}` |
| `发出（{{ outbound.length }}）` | `{{ $t('collab.task.outbound', { count: outbound.length }) }}` |
| `文件` / `技能`（kind 三元） | `{{ it.kind === 'file' ? $t('collab.task.kind.file') : $t('collab.task.kind.skill') }}` |
| `未知群` | `{{ $t('collab.task.unknown_group') }}` |
| `安装` / `忽略` / `下载` | `{{ $t('collab.task.install') }}` / `{{ $t('collab.task.ignore') }}` / `{{ $t('collab.task.download') }}` |
| `已安装·重启生效` | `{{ $t('collab.task.installed') }}` |
| `'已装到 ' + activeRoot`（:title） | `$t('collab.task.installed_at', { root: activeRoot })` |
| `已忽略` / `无效包` | `{{ $t('collab.task.ignored') }}` / `{{ $t('collab.task.invalid') }}` |
| `删除` | `{{ $t('common.delete') }}` |

- [ ] **Step 3: 验证** + **Step 4: Commit** `feat(i18n): TasksView 文案迁移`

---

## Task 8: `useCollab.ts`

**Files:** Modify `web/src/collaboration/useCollab.ts`

- [ ] **Step 1:** `import { t } from '../i18n';`，把 `throw new Error('文件超过 40MB 上限')` → `throw new Error(t('collab.file.too_large'))`
- [ ] **Step 2:** 验证 + Commit `feat(i18n): useCollab 文案迁移`

---

## 验收

- [ ] `node scripts/check-i18n.js` 在协作区文件上零命中。
- [ ] `npm.cmd run typecheck` 通过。
- [ ] `npm.cmd test:web` 通过。
