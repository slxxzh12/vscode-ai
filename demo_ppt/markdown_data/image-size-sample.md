# 图片尺寸测试

用 `{width=...}` / `{height=...}` 控制 Markdown 图片显示尺寸。

## 1. 原始大小

![原始大小](sample-image.svg)

## 2. 固定宽度 120px

![宽 120](sample-image.svg){width=120}

## 3. 固定宽高 320 × 180

![320x180](sample-image.svg){width=320 height=180}

## 4. 百分比宽度 50%

![50%](sample-image.svg){width=50%}

## 5. 带 px 后缀

![320px](sample-image.svg){width=320px}

## 6. HTML 写法

<img src="sample-image.svg" alt="HTML 240" width="240">

---

如果以上图片尺寸依次变化，说明图片尺寸语法生效。
