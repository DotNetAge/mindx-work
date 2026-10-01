# Agent-Driven UI 三流派与 ui.* 命令通道设计共识

日期：2026-09-30
背景：讨论「Agent 运行时在 daemon、界面在客户端，如何控制界面」——经 agent-browser（CDP）技能引发，定调为 mindx-work 架构方向共识。

## 核心论断

**拥有客户端源码时，不需要（也不该）用 CDP 控制自己的界面。** CDP 是「控制不拥有源码的程序」（浏览器、第三方 Electron 应用）的解；把整个渲染进程的钥匙交给 Agent 换来的是无边界风险。行业正解是反向的：**客户端向 daemon 主动暴露一个受控的 UI 能力面**。

## 三大流派

| 流派        | 模式                                                   | 行业先例                                             | mindx-work 现状                                                                    |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 声明式投影  | Agent 永不操作界面，只发结构化描述，界面是事实的投影   | LSP/DAP、Claude Artifacts、MCP Apps、Jupyter         | **已实现**：仪表板 `.dash`（Agent 落文件 → tool_exec_end 事件 → DetailPanel 渲染） |
| 宿主 API 面 | 客户端注册成可寻址终端，暴露受控命令，Agent 经通道调用 | VS Code 扩展 API、JetBrains AI、macOS AX/AppleScript | **待做**：ui.* 工具（增量，白名单收窄）                                            |
| 进程外协议  | 模拟输入控制不可控程序                                 | CDP、WebDriver                                       | 仅用于别人的客户端（agent-browser 场景）                                           |

## ui.* 命令协议四纪律

本质：工具面在 daemon，执行端在客户端，事件总线是桥（现有 EventSource 推送通道加一类命令事件即可）。但「不过是发布事件」藏着四个工程要求：

1. **命令要有回执**：Agent 调 `ui.open_file` 必须知道做没做成，否则会向用户编造「已打开」。客户端 ack 回 daemon 或失败上报——事件是火后不管的，命令不能是。
2. **幂等 + 有序**：EventSource 断线重连会丢/重放。命令带 seq/uuid 客户端去重；断线窗口期操作类命令宁可丢弃不重放（避免重放打开十个文件）。
3. **能力协商**：客户端连接时声明支持的 ui.*（无头/旧版能力不同），daemon 按声明裁剪注册，别让 Agent 调没人听的命令。
4. **边界收紧**：协议白名单（https，无 file:// 直开）、路径限当前工作区，与 fs.* 工具同一套纪律。

## 命令三分类（首批候选）

- **导航类**：打开文件/详情轨道 → 落 explorer/Detail store 操作
- **通讯类**：发送信息到对话流 → 落 chatflow store
- **环境类**：打开浏览器/外部链接 → **由客户端执行 shell open**，不给 Agent 直连系统的钥匙

## 先例锚点

LSP 的 `workspace/applyEdit` / `showMessageRequest` 就是「运行时请求客户端做 UI 动作 + 等回执」的十年验证设计。秘密在：把「谁命令」和「谁执行」用一条窄协议隔开，Agent 眼里它只是普通工具，根本不知道对面是 GUI。

## 实施路径建议

声明式（流派一）为主已验证；命令式（流派二）从一两个高价值能力起步（如「Agent 指定客户端打开某详情/面板」），每步都过白名单 + 确认。

## 补充权衡：一对多回执与提示注入（2026-09-30 追加）

**多端回执**：daemon 不知道客户端（架构原则），命令路由收进会话——daemon 只维护「会话→焦点端」最小映射（连接声明、focus 更新，属会话元数据非客户端身份，类比邮局知道地址不知道收件人）。命令走焦点端拿回执，其余端靠既有事件流同步；幂等命令可全端同发。备选：受理+ui.status 观察通道（无映射时用，有时序间隙）。

**提示注入三道闸（防滥用顺序：物理 > 描述 > 知识）**：
1. 物理闸——无人值守会话不注册 ui.* 工具，没有工具就不可能滥用；
2. 描述闸——触发纪律写在工具 description（「仅用户明确要求时」），工具 schema 不占系统提示；
3. 知识闸——详细用法沉为 mindx-ui 技能（与 agent-browser 同构），经 skill 机制按需加载，系统提示零注入。

## 定稿：最小权限 CLI + 受理语义（2026-09-30 用户拍板）

- **形态**：`mindx ui open <路径>` / `mindx ui open-link <URL>`（写入技能），Agent 调用后 daemon 仅广播 `file_open` / `link_open` 事件（对齐现有 tool_exec_end/loop_end 的 snake_case 命名，不用 OnXxx 回调风格），客户端订阅执行——file_open 走现有 openFile 分发表，link_open 走 shell.openExternal，零新协议。
- **放弃回执的理由**：受理即返回 + 效果发生在用户屏幕上（用户可见的即时纠错），配合最小权限已够；焦点路由映射留作将来需要时增量。
- **按需告知的双轨**：技能 = 说明书（怎么用）；fs.write 工具结果尾部追加一句时机提示（「如需呈现给用户，可执行 mindx ui open …」）= 每次生成文件必然出现的时机信号，比技能更主动，零机制成本。
- **参数闸**：open 路径解析后必须落在当前工作区；open-link 仅 http/https。

## 定稿三件套（2026-10-01 用户拍板：就这三个，完整）

| 命令                     | daemon 事件  | 客户端行为                                                                        |
| ------------------------ | ------------ | --------------------------------------------------------------------------------- |
| mindx ui open <路径>     | file_open    | 走现有 openFile 分发表（doc/svgboard/仪表板/webviewer 均为 Detail，行为天然统一） |
| mindx ui open-link <URL> | link_open    | shell.openExternal                                                                |
| mindx ui run <命令>      | terminal_run | 打开终端插件新会话执行命令                                                        |

- **事件收敛为三个**：mindx-work 文件类型 → Detail 的分发本来就是统一行为，file_open 一个事件覆盖全部文件类型，无需按类型细分事件。
- **ui run 的定位**：不是能力扩张（Agent 本就能跑 CLI），是执行可见化——命令在用户终端插件里、用户眼皮底下执行，比 Agent 静默后台执行风险更低。受理语义：工具结果 = 「已提交到终端」。
- **典型场景**：需要验证令牌时 open-link 打开授权网站，用户登录后获得返回；需要展示长任务进度时 ui run 起一个用户可见的进程。
- **参数闸沿用**：open 工作区路径闸、open-link 仅 http/https；run 命令本身就是「给用户看」的，无需额外限制（与 Agent 直跑命令同一权限级）。

## 实施记录（2026-10-01 三仓库落地）

**mindx（daemon + CLI）**：`internal/svc/handler_ui.go`（ui.open/ui.open_link/ui.run 三 RPC → `broadcastUI` 广播 file_open/link_open/terminal_run，envelope 对齐 permission_request 旁路 {type, data}）、`handler_registry.go` 注册、`cmd/ui.go`（cobra 三子命令 + `resolveWorkspacePath` 工作区闸 + `callUI` 受理打印）、`pkg/rpc/ui.go`（typed 参数）。测试：`cmd/ui_test.go`（路径闸）、`internal/svc/handler_ui_test.go`（受理语义）。参数闸全部在 CLI 侧（open 落 cwd、open-link http/https、run 上报 cwd），daemon 信任并广播。

**mindx-work**：
- chatflow/store.ts：`onEvent('file_open')` → openFile 分发表（绝对路径直用）。
- terminal：`pending.ts` 模块级 `pendingTerminalCommand` ref（同插件内共享，不跨插件）；index.ts 订阅 terminal_run → 入队 + `ctx.Detail.show('terminal')`；TerminalPanel spawn 时 pending.cwd 优先（Agent 工作区），会话就绪 `consumePending()` 写 `command + '\r'`，tab 已开场景 watch 消费。
- web-viewer/index.ts：订阅 link_open → `window.mxDesktop.openExternal`（Electron），纯 Web 降级 window.open。**link_open 必须走系统浏览器**：授权登录站 X-Frame-Options 拒绝 iframe，不能落 web-viewer 内嵌。
- electron：navigation.ts `registerOpenExternalBridge`（mx:open-external，isWebUrl 校验）+ preload `openExternal` + desktop-bridge.ts 类型。

**mindx-desktop**：connectionStore.registerEventHandlers 三订阅——file_open 内联 `resolveFilePathCandidates + vscode.open`（不 import useNodeActions，防 store→useNodeActions→store 循环依赖）；link_open → `window.api.browser.openExternal`；terminal_run → `vscode.window.createTerminal({cwd}) + show + sendText(cmd, true)`（monaco-vscode-api extension.api 支持确认；node-pty 服务为单 pty，新终端替换旧会话属既有机制）。

**遗留**：daemon 需重启加载新 RPC（~/.mindx/bin 覆盖 + mindx restart，沙箱外操作用户未授权）；端到端验证（mindx ui open → 客户端 Detail 打开）待 daemon 重启后补做。

## 共识：三工具是 Agent 与用户交互的标准通道（2026-10-01 用户拍板）

Open / Visit / TerminalRun 进入默认工具集后，Agent 获得了操作用户界面的能力。使用纪律（技能编写与 Agent 行为约定）：

- **显示结果**：技能生成产物后立即用 Open 呈现——如 dashboard 技能生成仪表板后马上 Open 打开；生成报告/图表/画板同理。不需要用户查看的中间文件不 Open。
- **响应用户请求**：用户说「帮我打开 XXX」→ Open；用户要求看某个网页/需要登录授权 → Visit。
- **执行可见化**：长任务、dev server、watch 等需要用户看到进度的进程 → TerminalRun（与 Bash 静默后台执行的本质区别是对用户可见）。
- **file_open 覆盖链（两客户端统一兜底语义）**：内置查看器/编辑器 → 无内置查看器的类型（pdf/office/压缩包/媒体等）→ 系统默认程序（shell.openPath 桥：mindx-work mx:open-path / mindx-desktop browser:openPath）。monaco 是文本编辑器开二进制只会乱码，所以 mindx-desktop 按 SYSTEM_OPEN_EXTS 集合分流；mindx-work 按分发表未命中分流。
- 技能不必逐一教 Agent 用这三个工具（已在默认工具集，描述即说明书）；技能文档只在行为编排需要处提一句（如「生成后 Open」）。
