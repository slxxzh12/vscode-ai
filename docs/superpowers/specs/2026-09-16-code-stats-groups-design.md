# 设计文档：代码统计——员工分组标签 + 组比率饼图

日期：2026-09-16
分支：master
状态：已确认

## 1. 目标

在代码统计里手动把员工（作者）分到 A组/B组等自定义组，统计**组比率**并用饼图展示。两个页签都支持：

- Git 提交统计：按「修改人」打标签，组比率按**新增行数**
- 实代码统计：按「首次提交人」打标签，组比率按**实代码行**

## 2. 已确认的决策

| # | 决策 | 来源 |
| --- | --- | --- |
| 1 | 两个页签都能打标签、各自出饼图 | 用户选 2 |
| 2 | 先「分组管理」增删组名，再在每行用下拉选组 | 用户选 2 |
| 3 | 组比率口径 = 代码行数（Git=新增行数 / 实代码=实代码行） | 用户选 1 |
| 4 | 分组定义 + 成员归属存服务端文件，同端口多浏览器共享 | 用户选 2 |
| 5 | 一份分组两页签共用，**按作者名匹配** | 本设计 |
| 6 | 未归属的行 → 饼图「未分组」单独一片 | 本设计 |
| 7 | 单组（不做多标签） | 本设计 |

## 3. 存储与接口

文件 `<数据目录>/code-groups.json`：

```json
{ "groups": ["A组", "B组"], "members": { "张三": "A组", "李四": "B组" } }
```

`server/code-groups.js`：

- `normalizeGroups(input)`（纯函数，可测）：`groups` 去空/去重/每项 ≤40 字/最多 50 个；`members` 仅保留「key 非空且值在 groups 内」的项。
- `createCodeGroups({ file, logger })` → `{ read(), write(next) }`；写盘 mkdir + 临时文件 rename；`file` 为空时纯内存（供测试）。

接口（`server/http-api.js`，注入 `codeGroups` 依赖，缺省为内存实例）：

- `GET /api/code/groups` → `{ groups, members }`
- `POST /api/code/groups` body `{ groups, members }` → 归一化后落盘并返回归一化结果

`server/port-paths.js` 增 `codeGroupsFile`；`server/index.js` 装配 `createCodeGroups({ file: paths.codeGroupsFile })` 并传入 `createHttpApi`。

## 4. 前端

- `web/src/codeGroups.ts`：
  - **模块级单例状态**（`groups`/`members`）、`useCodeGroups()` 暴露 `load()`/`save()`/`addGroup()`/`removeGroup()`/`assign(author, group)`（去抖保存）。
  - `groupSlices(items, members)` 纯函数：`items=[{key,value}]` → `[{name, value}]`（组名或 `''` 表未分组），按 value 降序。
- `web/src/components/GroupPie.vue`：echarts `PieChart`（复用 `UsageTrendChart` 的 init/resize/dispose/dark 模式），tooltip/图例 `组名: 值 (x%)`；空数据不渲染。
- `web/src/components/GroupManager.vue`：`el-dialog`，增删组名 + 保存/失败提示。
- `CodeStats.vue`：共享区加「分组管理」按钮 + `GroupManager`；挂载时 `load()`。
- `GitAuthorTable.vue`：每行「组」下拉（组列表 + 空），改动即 `assign()`。
- `GitStat.vue`：`作者行 → linesAdded` 汇总 → `GroupPie`。
- `RealCodeStat.vue`：新增「按首次提交人」表（作者 | 实代码行 | 占比 | 组下拉，无首次作者归「未知作者」）→ `GroupPie`（按 `real`）。

## 5. 范围边界

- 不做多标签、不按组筛选、不做组的历史趋势、不改 Git/实代码的既有统计口径。
- 同名不同邮箱视为同一人（按作者名匹配）。

## 6. 测试

- `server/test/code-groups.test.js`：`normalizeGroups` 去重/截断/丢弃非法成员；文件读写往返；坏 JSON 回退空。
- `server/test/http-api.test.js`：`GET /api/code/groups` 默认空；`POST` 保存后 `GET` 读回；非法值被归一化。
- `web/src/codeGroups.test.ts`：`groupSlices` 汇总、未分组归并、降序、空输入。
- `typecheck` / `check:i18n` / `build:web`。

## 7. 风险与取舍

- 分组按作者名匹配：同名同事会合并（个人工具场景可接受）。
- 组名修改不会自动迁移已有成员归属（成员值不在组内即被丢弃）——移除组会清掉该组成员。

## 8. 补充（同日追加）

### 8.1 过滤值改存服务端

原先代码后缀 / 排除目录 / 排除测试文件 / 超大提交阈值存在浏览器 localStorage。改为与分组一致的**服务端持久化**，同端口所有浏览器共享：

- 文件 `<数据目录>/code-prefs.json`；只存**用户改过的键**，缺键由前端回退默认值（新默认值对未改过的人自动生效，不覆盖改过的人）。
- `server/code-prefs.js`：`normalizeCodePrefs`（仅已知键；文本键截断 4000 字；布尔键仅接受布尔）+ `createCodePrefs`（复用新的通用 `server/json-store.js`，`code-groups.js` 也改用它）。
- `GET/POST /api/code/prefs`；`port-paths.js` 增 `codePrefsFile`；`index.js` 装配后注入 `createHttpApi`。
- 前端 `web/src/codePrefs.ts`：模块级 `prefs` + `mergePrefs(saved, base)` 纯函数 + 深度 watch 去抖 500ms 上报。
- 仓库目录列表与「最近目录」仍留在 localStorage（属本机路径偏好，不跨机共享）。

### 8.2 代码后缀补 sql/xml + 清单/锁文件内置排除

- `DEFAULT_CODE_EXTS` 增 `.xml`（`.sql` 原已在列）；`scripts/count-code.js` 的 `EXT` 同时补 `.sql`、`.xml`，CLI 与界面口径一致。
- 新增 `SKIP_BASENAMES`（`package.json`、`package-lock.json`、`npm-shrinkwrap.json`、`yarn.lock`、`pnpm-lock.yaml`），在 `makeKeepPath` 里**按文件名内置排除**——即使把 `.json`/`.yaml`/`.lock` 加进后缀白名单也不会被算成代码。
- `DEFAULT_EXCLUDE_DIRS` 增 `node_modules`（原本扫描器/CLI 已硬跳过，这里显式化到可编辑的排除目录里）。
