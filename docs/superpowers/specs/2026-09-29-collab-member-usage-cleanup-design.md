# 群主批量清理群成员与用量统计 设计

> 日期：2026-09-29
> 范围：协作群成员维护、用量上报快照、SQLite 用量表、统计成员表 UI

## 背景与目标

统计「机器用量」表按 machineId 分行（`mergeMachines(peers, members)`，见 `web/src/collaboration/usagePeers.ts`），同一台机器的多个历史身份（换端口 / 早期运行）会以同名多行出现；且当前代码已无「剔除群成员」能力。实际诉求：

1. 群主能把成员移出群；
2. 群主能把统计表里多余的机器行（含只上报过用量、不在群里的 B 类身份）清理干净；
3. 清理时把该机器在本机的用量历史一并删除；
4. 不通知被清理方，也不拦截其后续上报（如再次出现再手动清理）。

本设计落地：群主（当前群 hub）在统计成员表顶部进入「清理」多选模式，批量删除选中的非自身机器行——移除其群成员身份并删除其用量历史。

## 范围与取舍

- 可删对象：除群主自身 machineId 以外的所有行（A 当前群成员 + B 仅上报机器）。
- 删除范围：群成员身份按当前群移除；用量数据（`usage` 表行 + `usage-peers.json` 快照）按 machineId 全局删除（用量表无 group 维度）。
- 不通知被删机器；不维护黑名单（其再上报会再次出现，可再删）。
- 成员删除与用量删除**非事务**：第二步失败会提示，可能残留。
- 仅群主可见/可用该入口。

## 数据层（新增删除方法）

- `server/usage-store.js`：`deleteByMember(machineId)` → `DELETE FROM usage WHERE member_id = ?`，返回删除行数。
- `server/usage-peers.js`：`remove(machineIds)` → 从 `this.data.peers` 删对应键并 `save()`，对每台调 `this.store?.deleteByMember?.(id)`，返回删掉的快照数。
- `server/collaboration/store.js`：`removeGroupMembers(groupId, machineIds)` → 过滤 `g.members` 后 `save()`，返回新群。
- `server/collab-db.js`：`removeMembers({ groupId, machineIds })` → 删 `member` 与 `member_command` 两表对应 `(group_id, machine_id)` 行。

## 服务端接口（各管各的）

- 群成员移除（`server/collaboration/http-mount.js`）：
  `POST /api/collab/groups/:id/members/remove`，body `{ machineIds: string[] }` → `engine.removeMembers({ groupId, machineIds })`。
  - `engine.removeMembers`：校验 `groupId` 存在且 `hubId === 本机 machineId`，否则 `not-master`；过滤空值与自身 machineId；`store.removeGroupMembers` + `collabDb.removeMembers`；返回 `{ code:'ok', removed:[ids] }`。
  - HTTP 映射：`not-master` → 403；`no-target` → 400；成功 200。
- 用量删除（`server/usage-mount.js`）：
  `POST /api/usage/peers/remove`，body `{ groupId, machineIds: string[] }`。
  - 注入两个回调：`isHub(groupId)`、`selfId()`；非 hub → 403，过滤自身 machineId；`peers.remove(ids)`；返回 `{ removed }`。
  - `server/index.js` 装配时注入（engine 已创建）：`isHub: (gid) => { const g = engine.store.findGroup(gid); return !!g && g.hubId === engine.pub.machineId; }, selfId: () => engine.pub.machineId`。

## 前端

- `web/src/collaboration/useCollab.ts` 新增：
  - `removeMembers(groupId, machineIds)` → `POST /api/collab/groups/:groupId/members/remove`。
  - `removeUsagePeers(groupId, machineIds)` → `POST /api/usage/peers/remove`。
- `web/src/collaboration/MemberUsageTable.vue`：
  - 顶部工具栏加「清理」按钮，仅当 `activeGroup.hubId === snap.identity.machineId` 时显示。
  - 点击进入多选模式：`el-table` 加 `type="selection"` 列，`:selectable` 排除 `row.machineId === me`；出现「删除选中」「取消」。
  - 确认框后：先把选中里属于群成员的 id 调 `removeMembers`（为空则跳过该调用），再对全部选中 id 调 `removeUsagePeers`；随后 `await props.collab.refresh()` 并 `emit('removed')`。
  - 失败 `alert` 提示；成功后清空选择并退出多选。
- `web/src/collaboration/GroupView.vue`：监听 `MemberUsageTable` 的 `removed` → 调 `loadPeers()`，刷新用量快照。

## i18n

`shared/i18n/zh-CN.js` + `en.js` 对称补齐：
- `collab.member.clean`（清理）、`collab.member.clean_select`（请选择要清理的机器）、`collab.member.clean_confirm`（确认删除选中的 {count} 台机器？其用量历史将一并删除）、`collab.member.clean_done`（已清理 {count} 台）、`collab.member.clean_failed`（清理失败：{msg}）、`collab.member.clean_cancel`（取消）。

## 测试

- server：
  - `usage-store`：`deleteByMember` 只删指定机器、其它机器保留。
  - `usage-peers`：`remove` 删快照键并联动删 `usage` 表行。
  - `collab-db`：`removeMembers` 删 `member` + `member_command`。
  - `engine.removeMembers`：非 hub 拒绝、过滤自身、成功移除。
  - `usage-mount`：`/api/usage/peers/remove` 权限（非 hub 403）、过滤自身、空参数 400。
  - `http-mount`：`groups/:id/members/remove` 成功 / 非群主 403。
- web：
  - `MemberUsageTable`：仅 hub 显示「清理」；选择列排除自身；确认后按预期调用两个方法并刷新。
  - `useCollab`：两个新方法命中正确路由。

## 边界

- 自身 machineId 永不可删（前端排除 + 后端过滤）。
- 空 `machineIds` 或全为自身 → 400 / `no-target`。
- 非群主调用 → 403。
- 存量历史（如 `1b86d1df` 这类旧身份）通过 B 类清理即可移除；其若仍持有令牌会再次上报并出现，需再手动清理（设计取舍）。
