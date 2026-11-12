# demo_plugins

「AI 小工具」默认从这里读取插件（当前目录下的 `demo_plugins/`）。每个子目录是一个插件，必须包含 `manifest.json`。

`manifest.json` 字段：

- `name`：显示名称
- `description`：说明
- `workflow`：相对插件目录的提示词文件路径（如 `workflow.md`），作为 `opencode run <prompt>` 的内容
- `fields`：表单字段数组，每项 `{ key, label, type, required?, options?, default?, placeholder? }`，`type` 支持 `text / textarea / select / number / checkbox / date / color / password / email / url / tel / range`
- `logo`：可选，插件目录下的图片文件名（png/jpg/jpeg/gif/webp/svg）

运行时会把插件目录复制到本次运行的临时目录，并写入 `input.json`（表单值）；提示词可读取当前目录的 `input.json`，产物写到 `output/`。

## 多文件工作流

`workflow` 可以指向一个「入口 Markdown」，把同一个工作流拆成多个子文件来描述。运行时会把**入口文件所在目录整体复制**到运行目录，因此入口里可以直接引用同目录下的子文件。

示例见 `fs-stats/`：

```
fs-stats/workflow/
  workflow.md        # 入口：按顺序串联下面的步骤
  01-count-js.md     # 第一步
  02-total-size.md   # 第二步
  samples/           # 示例数据
```

入口 `workflow.md` 里写明「读取并执行 01-count-js.md、再执行 02-total-size.md」，AI 会按顺序读取这些子文件完成任务。
