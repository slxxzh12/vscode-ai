# 移动端首次进入底部 composer 放大设计

## 背景

手机远程页（`/?phone=1` → `PhoneView` → `TerminalView` 的 `phone` 模式）首次进入时：

- `composerMin = ref(true)`（`TerminalView.vue:617`）→ 底部 composer 收起为 40px，只露一排按钮，输入面板被隐藏。
- 手机默认高度 `composerH = ref(props.phone ? 150 : 240)`（`TerminalView.vue:616`），展开后也偏矮。
- `.composer.phone` 下的按钮/输入框沿用了桌面字号，手机上偏小。

## 目标

移动端首次进入即展开底部 composer，并让工作流/动作按钮与输入面板更大、更易点。

## 设计

### 1. 默认展开（仅手机）

`web/src/components/TerminalView.vue` 中：

```typescript
const composerMin = ref(true);
```

改为：

```typescript
const composerMin = ref(props.phone ? false : true);   // 手机首次进入即展开；桌面保持收起
```

现有 `watch(activeIsAgent, (v) => { composerMin.value = !v; })` 不变。

### 2. 手机默认高度

```typescript
const composerH = ref(props.phone ? 150 : 240);
```

改为：

```typescript
const composerH = ref(props.phone ? 200 : 240);
```

（`composerH` 仍会被 `localStorage` 的 `devflow-composer-h-phone` 覆盖，故只影响首次进入/无历史高度时。）

### 3. 手机端底部控件放大

在 `.composer.phone` 作用域内新增/覆盖（`TerminalView.vue` 手机样式段，约 1284-1298 行）：

```css
.composer.phone .cbar { height: 30px; }
.composer.phone .stage { font-size: 13px; padding: 4px 14px; }
.composer.phone .chip { font-size: 12px; padding: 3px 12px; }
.composer.phone .cbtn { font-size: 13px; padding: 3px 10px; line-height: 20px; }
.composer.phone .cinput { font-size: 15px; }
.composer.phone .cact { font-size: 14px; }
.composer.phone .cagentacts { min-width: 72px; }
.composer.phone .csend { font-size: 17px; padding: 0 20px; }
```

说明：

- `.cbar` 的基类 `height: 26px`；手机加到 30px。
- `.cact` 基类字号 12、`.cagentacts` 基类 `min-width: 84px`；手机改为 14 / 72（按钮更易点，整体更窄以适配小屏）。
- `.csend` 手机现有覆盖为 `min-width: 0; padding: 0 16px; font-size: 14px;`，本次在既有行上把字号/内边距调大（保留 `min-width: 0`）。
- `.cinput` 手机现有覆盖为 `padding: 30px 12px 8px 12px;`，本次只加 `font-size: 15px`。

## 涉及文件

- `web/src/components/TerminalView.vue`（`composerMin` / `composerH` 默认值 + `.composer.phone` 样式）。

## 测试

纯视觉/默认值改动，无既有 `TerminalView` 组件测试。验证方式：

- `npm.cmd run typecheck` 通过。
- 手动：dev 下手机模式（窄屏或 `/?phone=1`）首次进入，composer 直接展开、按钮与输入框明显变大；收起/展开按钮仍可用。

## 非目标

- 不改桌面端 composer 的默认收起行为与尺寸。
- 不改手机页顶部工具栏（标题/截图/JSONC）。
- 不引入新的持久化项（`composerMin` 仍不落盘）。
