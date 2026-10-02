# mindx-work 架构总览

本文整合架构性、全局性的定稿设计（来源：`mindx-work/docs/界面层选型.md` 定稿与内核/适配器实现实证）。改动架构前先读本文；改完架构必须同步更新本文与受影响的技能（见 SKILL.md 技能同步军规）。

## 1. 项目定位

mindx-work 是一个构建类 Mac 应用的 **UI 框架（shell）**：无渲染内核 + 八视图区 + 插件运行时组装。框架 API 零业务词汇、渲染库无关、不做状态管理；界面由预置插件组装而成，换业务领域框架代码零改动。

全栈 NodeJS：主进程、渲染进程、预置插件均为 Node/TS 生态。

## 2. 技术选型（定稿 2026-09-24）

决策记录格式约定：每个定稿决策必须包含**选择理由**、**后果**（硬纪律）、以及**放弃了什么**（被拒备选与拒绝理由）——只写"定了什么"不写"放弃了什么"的记录不算定稿；后续决策修改本表时同步补全三要素。

| 项       | 决策                                      |
| -------- | ----------------------------------------- |
| 渲染库   | Vue 3（Composition API + SFC）            |
| 状态管理 | Pinia                                     |
| 桌面宿主 | Electron                                  |
| 样式实现 | CSS Modules + `--mx-*` token              |
| 工程底座 | pnpm workspace + Vite + TypeScript strict |

### 渲染库：Vue 3 + Pinia

选择理由：

- 响应式模型声明式直改即更新，无 hooks 闭包/手动 memo 负担。
- Pinia store 是 `services.provide` 的理想实现——provide 进去的就是响应式本体，消费端零桥接；状态管理问题随选型一并解决。
- 模板编译期优化，同场景产物更小。

后果：

- 第一个适配器为 `ui-shell-vue`：条目 `component` 收窄为 Vue 组件类型；React 适配器延后，架构不依赖。
- 内核仍渲染无关：机制状态（activeId、shown、overlay 栈）为可变结构 + 版本订阅，由适配器映射为 Vue 响应式。
- 插件内部状态一律 Pinia；`services` 通道中流动的是 store 实例。

### 桌面宿主：Electron

选择理由：与现有 mindx desktop 同栈，工程惯性共享；Chromium 渲染一致性最好。

后果（硬纪律）：

- **主进程只做窗口壳**：窗口生命周期、原生菜单、Dock/托盘等系统能力，禁止业务逻辑，也不做消息转发。
- **Agent 服务是服务插件**：以服务插件形式经 `services.provide` 挂载进壳，成为普通服务；其连接与协议细节归该插件自理，Electron main 对其零感知。
- **安全基线**：`contextIsolation` 开启，渲染进程无 `nodeIntegration`；preload 仅暴露窗口级能力。

## 3. 工程形态

```text
mindx-work/
├── ui-shell/          # 内核：AppShell + 八区 + 插件契约（渲染无关，零 Vue 依赖）
├── ui-shell-vue/      # Vue 适配器：条目渲染 + 类型收窄（C = Vue 组件）
├── plugins/           # 预置插件（Pinia；daemon-link 通信插件在此）
├── electron/          # 主进程窗口壳（薄，无业务）
└── app/               # 组装入口：createApp(预置清单) + Vue 挂载
```

依赖方向单向：`app → plugins → ui-shell-vue → ui-shell`；插件不得反向依赖 app 或互相 import（共享走 services）。

## 4. 分层与运行链路（实现实证）

| 层 | 包 | 职责 |
| --- | --- | --- |
| 内核层 | ui-shell | 可变注册表（八区条目）+ ChangeHub 版本通知 + services + 启动期校验（`validateOrThrow`） |
| 适配层 | ui-shell-vue | 八区渲染组件（AppFrame/各 Pane）+ MxIcon + 主题控制器 + 薄桥（`useShell`/`useShellData`/`useService`）+ mx-UIKit 样式 |
| 插件层 | plugins | 插件 = 函数 `(ctx) => void \| cleanup`；demo 为范式；配置与服务经 services 共享 |
| 装配层 | app | `createApp([插件...])` → services.provide → `mountVueApp`（装配 SHELL_KEY 上下文与 Pinia） |
| 宿主层 | electron | macOS vibrancy 材质、平台标记（`data-platform`）、窗口拖动带；零业务 |

运行链路（两条，均为实证，细节读 mx-plugin-dev 技能）：

1. **壳机制联动**：命令 API（`Content.activate` / `Detail.show` / `Overlay.add`…）改注册表/壳状态 → `hub.bump()` 版本递增同步投递 → 适配器 `useShellVersion` 更新 → `useShellData` 的 computed 重读 → 视图更新。
2. **插件内部状态**：Pinia store（Model）+ SFC 声明式绑定（View）；跨插件共享经 services（流动响应式本体）。

全程无事件总线。

## 5. 常用命令（仓库根 package.json）

```bash
pnpm dev          # 起 dev（@mindx-work/app，端口 5273；避开 5173——本机浏览器可能有残留 Service Worker）
pnpm build        # 构建 @mindx-work/app
pnpm typecheck    # vue-tsc --noEmit -p app/tsconfig.json（验证 SFC + TS，勿用裸 tsc）
pnpm lint         # oxlint（correctness 类别；行内豁免必须附中文理由注释）
pnpm test         # node --test（scripts/*.spec.mjs；脚本关键逻辑同受测试）
```

## 6. 持久化代际纪律（会话存储前瞻军规）

本项目将来引入会话/用户数据持久化（Session 消息历史、配置、用量统计）时，从第一天起遵守：

- **已落盘的代际永不移动、改写、删除**：格式演进只新增带版本命名的继任格式，旧代际保持原样（迁移读取，不回写）。
- **schema 版本号单调递增**（如 SQLite `SCHEMA_VERSION` 模式）；读取到未知版本时明确拒绝并提示，禁止猜测性兼容。
- **旧代际的存在不代表支持降级**：新代码读旧格式允许，写回必须用当前格式（或拒绝）。
- 校验发生在此处（读回边界）——与 mx-plugin-dev 契约 §17 数据校验边界同源。

## 7. 插件分发层（动态插件，定稿 2026-09-25）

机制细节（包格式、manifest 字段、协议、IPC 桥、加载器）读 mx-plugin-dev 技能 `references/contract.md` §18；本节记录定稿决策与理由（三要素）。

| 项 | 决策 |
| --- | --- |
| 插件双类 | 项目插件（core，不可删除）与在线插件（market，可下载/更新/卸载）；**唯一差异是可删除性**，同一契约同一注册机制 |
| 版本语义 | id 是身份，version 是不可变代际，activeVersion 是激活指针；更新不删旧版、回滚切指针、卸载才删全部 |
| 信任模型 | 显式安装即信任（安装确认 UI 呈现元数据与权限 + sha256 校验）；放弃 node:vm 沙箱（安装即本机手势，对齐 DSH 面板手势免审批） |
| 市场服务器 | 静态托管 index.json（多版本数组）+ zip 包；放弃动态注册中心（无服务端状态、可 CDN 化） |
| 加载通道 | 特权协议 `mx-plugin://<id>/<version>/<file>`；放弃 http dev origin / file 直接 import（Chromium 拒绝，实证） |
| 校验分工 | 渲染侧 `manifestIssues` 唯一语义校验家；主进程只做机械校验（格式/越界/后缀白名单）——契约 §17 边界分工的实例 |

后果（硬纪律）：

- 动态插件入口签名 = `default(app, { h, MxIcon })`，第一参与静态插件完全相同；第二参是"无 npm import 通道"的补偿注入，动态插件禁止 import 工程内模块。
- `installed.json` 是状态文件受 §6 代际纪律约束（`schemaVersion: 1` 起步，未知版本拒绝）；版本目录属程序资源允许同版本重装覆盖。
- `protocol.registerSchemesAsPrivileged` 必须在 app.ready 前调用（模块顶层），app.ready 后调用静默无效。

### 真机验收链路（market 机制专用，与普通插件 dev 5273 链路并行）

已归 mx-plugin-dev 技能 `references/contract.md` §18.8（2026-10-02 迁移，机制细节统一归 contract.md）；本节不再重复。
