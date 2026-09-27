---
name: mx-dev-guide
description: mindx-work 开发指南。开始任何 mindx-work 相关开发前必读：项目背景、总体架构、技能分流军规（界面设计用 mx-uikit、插件开发用 mx-plugin-dev）与技能同步军规、架构设计文档索引。
---

# mindx-work 开发指南

## 何时使用

- 开始任何 mindx-work 相关开发之前（先读本技能定方向，再按分流进入专项技能）。
- 修改架构、工程形态、技术选型之后（同步本文档与各专项技能）。

## 项目背景

mindx-work 是一个构建类 Mac 应用的 **UI 框架（shell）**：无渲染内核 + 六视图区（Sidebar / Content / Detail / Overlay / Toolbar / Settings）+ 插件运行时组装。框架 API 零业务词汇、渲染库无关、不做状态管理；界面由预置插件组装而成。全栈 NodeJS：Vue 3 + Pinia + Vite + TypeScript strict + pnpm workspace，Electron 只做窗口壳。

## 总体架构

五包单向依赖：`app → plugins → ui-shell-vue → ui-shell`（+ electron 薄壳）。

| 层 | 包 | 职责 |
| --- | --- | --- |
| 内核层 | ui-shell | 可变注册表 + ChangeHub 版本通知 + services + 启动期校验 |
| 适配层 | ui-shell-vue | 六区渲染组件 + MxIcon + 主题 + 薄桥 + mx-UIKit 样式 |
| 插件层 | plugins | 插件 = 函数 + ctx + 清理函数；插件间共享走 services |
| 装配层 | app | createApp(插件清单) → services.provide → mountVueApp |
| 宿主层 | electron | macOS vibrancy / 平台标记 / 窗口拖动带 / 系统驻留图标（托盘），零业务 |

运行链路与选型决策读 `references/architecture.md`。

## 基本军规

1. **界面设计用 mx-uikit 技能**：token、控件原语、色彩/字体/布局规范一律从 mx-uikit 取。
2. **插件开发用 mx-plugin-dev 技能**：契约、场景生成、插件军规一律从 mx-plugin-dev 取。
3. **打包与发布用 mx-release 技能**：打包命令、证书与公证、CI secrets、产物验证一律按 mx-release 工作流执行，禁止临场自造打包步骤。
4. **技能同步军规**（改了代码不改技能 = 未完成）：
   - 界面设计发生**任何影响全局的变化** → 马上升级 mx-uikit；
   - 任何涉及**插件契约或机制**的变化 → 更新 mx-plugin-dev；
   - 打包配置（`electron/electron-builder.yml` / `scripts/pack.mjs` / release workflow）变化 → 更新 mx-release；
   - 改动**涉及多个插件** → 先生成升级技能，在技能中把执行效果调优到位，然后直接执行该技能完成对各插件的修改。
5. **架构与设计文档同步**：架构性、全局性的变化必须同步更新本技能的 `references/architecture.md`，并检查 `mindx-work/docs/` 定稿文档是否需要修订。
6. **抽象须有当前消费者**：新增抽象、选项、兼容路径必须有当下真实的消费者与证据；无证据的默认值一律显式指定或推迟决策，禁止"为将来可能需要"而设计（三行相似代码优于一个过早抽象）。这是全工程通用纪律，各专项技能同样适用。

## references 索引

| 文档 | 内容 | 何时读 |
| --- | --- | --- |
| [architecture.md](./references/architecture.md) | 技术选型定稿、工程形态、分层与运行链路、常用命令 | 改架构前；不熟悉项目时 |
| [project-layout.md](./references/project-layout.md) | 项目文件目录详解：逐包逐文件职责、新代码放哪 | 找文件、决定新代码位置时 |
| [desktop-shell.md](./references/desktop-shell.md) | 宿主层壳能力：系统驻留图标（托盘）菜单、关窗驻留、平台交互模型与坑 | 改托盘菜单、关窗行为、原生壳交互时 |
| [界面军规.md](./references/界面军规.md) | 主题 / 伪类 / 样式选用 / 图标九条军规全文（硬性规则） | 写任何界面样式前 |

## 任务分流

| 任务 | 去处 |
| --- | --- |
| 界面设计、控件、样式 | mx-uikit 技能 |
| 新插件从零起意（需求收集 / 席位设计 / 交互编排） | mx-plugin-design 技能 |
| 插件开发（新插件 / 改插件） | mx-plugin-dev 技能 |
| 在线插件机制（market / 包格式 / 版本代际 / 协议 / 市场安装） | mx-plugin-dev → references/contract.md §18；架构决策读本技能 → references/architecture.md §7 |
| 打包发布（安装产物 / 证书公证 / CI 发布） | mx-release 技能 |
| 插件发布市场（zip 打包 / index.json 登记 / 市场链路验收） | mx-plugin-publish 技能 |
| 全面代码审计 / 安全审查 / 机制体检 | mx-audit 技能 |
| 六区契约细节 | mx-plugin-dev → references/contract.md |
| 场景化插件生成 | mx-plugin-dev → references/examples.md + scripts/scaffold_plugin.py |
| 架构与选型 | 本技能 → references/architecture.md |
| 驻留图标菜单 / 关窗驻留 / 原生壳交互 | 本技能 → references/desktop-shell.md |
