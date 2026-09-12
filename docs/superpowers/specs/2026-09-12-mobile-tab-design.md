# 设计文档：移动（Mobile）页签 —— 手机远程控制电脑编程（落地介绍页）

日期：2026-09-12
分支：master
状态：待评审

## 1. 概述

在 devflow 网页左侧活动栏新增一个「移动」页签（📱），点击后进入一个**介绍落地页**，说明「用手机远程控制电脑进行编程」的用法，并展示 iOS / Android 两个客户端下载二维码，为后续正式推出的移动客户端做准备。

本轮只做**静态介绍页**，不实现实际的移动端远程控制功能。

已与用户确认的约束：

- 二维码目标：应用商店 / TestFlight **链接**，当前先用**占位 URL**。
- 二维码数量：**2 个** —— iOS（App Store）、Android（Google Play）。
- 二维码实现：**预生成静态图片**（运行时零依赖）。

## 2. 占位 URL

集中定义，后续拿到真实链接后替换并重新生成图片：

| 平台 | 占位 URL |
| --- | --- |
| iOS | `https://apps.apple.com/app/id0000000000` |
| Android | `https://play.google.com/store/apps/details?id=com.devflow.app` |

## 3. 架构与数据流

纯前端静态页面，无服务端改动、无新增运行时依赖。

```
点击活动栏 📱
  └─ App.vue: rail = 'mobile'
       └─ <section class="center"><MobileView /></section>
            ├─ 标题 / 定位 / 能力要点（$t 文案）
            └─ 下载卡片 × 2
                 ├─ <img src="/mobile/qr-ios.svg">      （静态资源）
                 └─ <a href="占位URL">扫码或点击下载</a>
```

## 4. 前端改动

### 4.1 `web/src/App.vue`

- `rail` 联合类型新增 `'mobile'`：
  `'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler' | 'proxy' | 'mobile'`
- 活动栏在「代理」之后、设置 ⚙ 之前新增按钮：
  `<button class="a-btn" :class="{ on: rail === 'mobile' }" :title="$t('nav.mobile')" @click="rail = 'mobile'">📱</button>`
- 顺带修正既有代理页签：图标 `🔌` → `🔀`（交叉箭头，更直观表示流量转发），并将名称由「代理」改为「中转站」；同步 `nav.proxy` / `llm.title` / `llm.proxy.title` / `llm.proxy.enable` 词条（en: `Relay`）。仅改文案与图标，不改交互。
- 渲染分支（与 `contacts/stat/scheduler/proxy` 同构，整宽 `.center`，无侧栏）：
  `<template v-else-if="rail === 'mobile'"><section class="center"><MobileView /></section></template>`
- 顶部 `import MobileView from './components/MobileView.vue';`

### 4.2 新增 `web/src/components/MobileView.vue`

结构：

1. 页头：标题 `mobile.title` + 一句话定位 `mobile.desc`。
2. 能力要点列表：3 条 `mobile.feat.*`（如：随时查看/接管终端、手机审阅代码与 diff、扫码即连无需配置）。
3. 下载卡片 × 2（iOS / Android）：
   - 平台名 `mobile.ios` / `mobile.android`；
   - 状态徽标 `mobile.coming_soon`（即将推出）；
   - 二维码 `<img :src="qrIos" :alt="$t('mobile.ios')">`；
   - 说明 `mobile.scan_hint` + `<a :href="IOS_URL">` 文本链接（便于桌面直接点击）。

要点：

- 全量文案走 `$t()`，禁止硬编码单语言。
- 图片路径用 `import.meta.env.BASE_URL + 'mobile/qr-ios.svg'`，兼容绿色包 / 非根路径部署。
- 样式复用 `ProxyView.vue` 的卡片变量风格（`--bd/--bg2/--tx*/--ac`），深浅色主题自适应；卡片在窄屏下自动换行（`flex-wrap`）。

### 4.3 静态资源

- `web/public/mobile/qr-ios.svg`
- `web/public/mobile/qr-android.svg`

生成方式（一次性，无需入库依赖）：

```
npx.cmd --yes qrcode -t svg -o web/public/mobile/qr-ios.svg "https://apps.apple.com/app/id0000000000"
npx.cmd --yes qrcode -t svg -o web/public/mobile/qr-android.svg "https://play.google.com/store/apps/details?id=com.devflow.app"
```

### 4.4 重新生成脚本 `scripts/gen-mobile-qr.js`

- 顶层集中定义 `IOS_URL` / `ANDROID_URL` 与输出路径；
- 通过 `child_process.execFileSync('npx.cmd', ['--yes','qrcode','-t','svg','-o',out,url])` 生成两张 SVG；
- 仅作维护工具，不参与构建与运行；`node scripts/gen-mobile-qr.js` 即可重生成。

## 5. i18n 词条

`shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 必须同时补齐（键集合对称）：

| key | zh-CN | en |
| --- | --- | --- |
| `nav.mobile` | 移动 | Mobile |
| `mobile.title` | 手机编程 | Code from your phone |
| `mobile.desc` | 用手机远程控制你的电脑，随时继续编程。 | Control your computer from your phone and keep coding anywhere. |
| `mobile.feat.terminal` | 随时查看并接管电脑上的终端会话 | View and take over terminal sessions on your computer |
| `mobile.feat.review` | 在手机上审阅代码改动与 diff | Review code changes and diffs on your phone |
| `mobile.feat.pair` | 扫码即连，无需手动配置 | Scan to connect, no manual setup |
| `mobile.ios` | iOS | iOS |
| `mobile.android` | Android | Android |
| `mobile.coming_soon` | 即将推出 | Coming soon |
| `mobile.scan_hint` | 扫码或点击下载 | Scan or click to download |

## 6. 测试与验收

- `npm.cmd run typecheck`：`rail` 联合类型与组件引用无误。
- `npm.cmd run check:i18n`：中英词条对称、`web/src` 用户可见范围零中文命中。
- `npm.cmd test:web`：现有用例不回归（本页为纯静态展示，不新增单测）。
- `npm.cmd run build:web`：静态资源随构建拷入 `dist`。
- 人工验收：`npm.cmd run dev:web` → 左侧出现 📱 → 点击进入介绍页 → 两张二维码可扫描出对应占位 URL → 中英切换即时生效 → 深浅色主题正常。

## 7. 边界与取舍

- **仅介绍，无功能**：移动端实际远程控制不在本轮范围。
- **占位链接**：二维码内容为占位 URL，替换真实链接需重新生成两张图片（脚本已提供）。
- **二维码离线生成**：只在开发机执行 `npx qrcode`，产物 SVG 入库，运行时与构建流程均不依赖该包；离线环境下可改由其它工具生成后替换同名文件。
- **不做响应式移动端适配**：本页面向桌面端 devflow 界面；移动端适配属于后续移动客户端项目。

## 8. 明确不做

- 不做移动端响应式布局 / 移动 Web 控制界面。
- 不实现手机与电脑之间的配对、鉴权、隧道或远程终端协议。
- 不接入应用商店上架流程、TestFlight 分发或版本检查。
- 不添加任何 npm 运行时依赖。

## 9. 决策记录

- 静态介绍页 + 占位二维码：用户确认「介绍页 + 应用商店/TestFlight 链接」，且先用占位 URL。
- 二维码 2 个（iOS + Android）：用户确认。
- 预生成静态 SVG：用户确认（运行时零依赖、零代码）。
- 用 `npx qrcode` 离线生成：在无 QR 依赖的现状下，以一次性工具产出静态图，避免污染依赖树。
- 代理页签改名与换图标：用户评审时提出原插头图标不直观，图标改 🔀；随后要求名称由「代理」改为「中转站」（en: Relay）。
