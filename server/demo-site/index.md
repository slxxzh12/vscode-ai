<style>
@keyframes df-demo-fade {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: none; }
}
.df-demo-cover { animation: df-demo-fade .7s ease both; padding: 8px 0 2px; }
.df-demo-cover h2 { margin: 0 0 8px; font-size: 1.6em; }
.df-demo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 12px; }
.df-demo-card { animation: df-demo-fade .7s ease both; background: rgba(76, 154, 255, .08); border: 1px solid rgba(76, 154, 255, .25); border-radius: 8px; padding: 10px 12px; }
.df-demo-card b { color: var(--ac2); }
</style>

# Markdown / PPT 能力展示

<div class="df-demo-cover">
  <h2>静态网站与 PPT 预览</h2>
  <p>这里演示最近支持的 Markdown 能力。右上角「PPT」可进入全屏演示，也可以访问 <code>?ppt=1</code> 自动打开。</p>
</div>

# PPT 预览模式

<div class="df-demo-grid">
  <div class="df-demo-card"><b>全屏演示</b><br>点击右上角 PPT，或使用 <code>?ppt=1</code> 自动进入。</div>
  <div class="df-demo-card"><b>按 H1 分页</b><br>一级标题切页，H2 及以下保留在同一页。</div>
  <div class="df-demo-card"><b>键盘翻页</b><br>←/→、PageUp/PageDown、空格、Home/End 均可翻页。</div>
  <div class="df-demo-card"><b>内容满屏</b><br>去掉 1200px 宽度限制，并减少顶部空白。</div>
</div>

# 表格展示

表格不再限制高度、不再截断单元格；内容换行后表格会向下撑开。数据不超过 20 行时不会出现筛选框。

| 功能 | 说明 |
| --- | --- |
| 长内容 | 这是一个很长的单元格内容，用来演示换行和行高自动撑开，不会出现省略号或隐藏内容。 |
| 排序 | 点击表头即可排序。 |
| 筛选 | 仅当数据超过 20 行时显示筛选框。 |

# CSS 动画与 SVG

<div class="df-demo-grid">
  <div class="df-demo-card" style="animation-delay: .1s"><b>@keyframes</b><br>淡入并上移。</div>
  <div class="df-demo-card" style="animation-delay: .2s"><b>内联 style</b><br>控制动画延迟。</div>
  <div class="df-demo-card" style="animation-delay: .3s"><b>SVG</b><br>内联 SVG 同样参与动画。</div>
</div>

<svg width="80" height="80" viewBox="0 0 80 80" style="margin-top: 12px; animation: df-demo-fade .8s ease both;">
  <circle cx="40" cy="40" r="30" fill="var(--ac2)" opacity=".8" />
</svg>

# 图表与流程图

```mermaid
flowchart LR
  A[Markdown] --> B[静态网站]
  B --> C[PPT 预览]
  C --> D[全屏演示]
```

```mermaid-data
return "pie title 能力分布\n  \"PPT\" : 40\n  \"表格\" : 30\n  \"动画\" : 30"
```

# 使用方式

1. 在「静态网站」页顶部点击「PPT 展示」直接打开本页并进入 PPT。
2. 点击「功能展示」可先浏览普通页面。
3. 普通 Markdown 页面右上角始终有「PPT」入口。
