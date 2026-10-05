# 市场团队整包招聘前端接入要点（mindx-work 插件端，2026-10-05）

## 同名不同物：两个"市场"

- `plugins/src/market/` 是 **Electron 插件包市场**（`window.mxDesktop.plugins` 桥的 marketList/installFromUrl，装的是宿主插件 zip），与 mindx daemon 的 `market.list` / `market.install`（分发包货架）**完全无关**。
- daemon 市场的既有消费者是 `plugins/src/agents`（kind=agent）与 `plugins/src/skills`（kind=skill），均经 `daemon.connection` 服务（纯字符串名 useService，插件间禁止 import，契约 §10.2）。
- 2026-10-05 团队整包（kind=team）货架按任务要求落在 market 插件：daemon 连接在 store setup 期 useService 用 try-catch 可选捕获（服务缺失时区块隐藏而非崩溃），其余 RPC 用法照抄 agents/skills 先例。

## team 包安装协议要点（daemon 冻结侧实证）

- `market.install` 参数 `{ kind: 'team', name, overwrite? }`；结果 InstallResult 新增 `members`（落位成员 Agent 名，含负责人）。
- 同名冲突报错有三种 label：`已存在同名团队/智能体 "x"`、`全局库已存在同名技能 "x"`——前端统一按消息含 `已存在同名` 匹配抛 TeamExistsError，走确认 → overwrite 重试。
- 安装落盘后 daemon 的 fsnotify watcher 广播 `agents_changed` / `teams_changed` / `skills_changed`；agents store 订阅广播静默重拉（范式同 skills 的 skills_changed），**不要**在 market 插件里跨插件直接调 agents store（禁 import）。

## 范式复用清单（新插件功能接入时照抄）

- 确认 modal：store 持 `pendingConfirm { title, message, confirmText, successText } + action 闭包`，组件 Overlay.add 纯内容 modal，同 id 先 remove 再 add。
- banner 通知：notice.ts + NoticeBanner.vue 插件自带副本，id 前缀 `market-banner-`。
- market.list 响应字段以 daemon `marketPackageDTO`（handler_bundle.go）为准：snake_case（nick_name/leader/members）+ camelCase（skillNames/skillDescs）混合，先读 Go 源再写 interface。
