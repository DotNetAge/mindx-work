# 跨端会话运行态（session.statuses 轮询）实施记录

日期：2026-09-29
任务：daemon 在其它端运行 SubAgent 时，mindx-work 侧栏会话列表要显示运行态，打开会话后 ChatInput 同步状态。

## 关键事实（踩坑后实证）

1. **daemon 事件按发起客户端单播**：`message_queued`/`message_processing` 等执行链路事件走 `gateway.SendResponse(clientID, ...)`（daemon.go L1035/L848），**只有发起执行的客户端收到**。前端"放开事件激活过滤"只能解决本端多场景，跨端状态唯一可靠来源是拉取。这是本次方案的根本依据。
2. **mindx 依赖发布的 goharness**（go.mod `v0.2.48`，replace 行默认被注释）：改 `core/goharness` 后 mindx 编译/构建必须临时启用 `replace github.com/DotNetAge/goharness => ../core/goharness`，验证完还原 go.mod + `git checkout go.sum`（`go mod tidy` 会改 go.sum）。
3. **daemon 由服务管理器拉起**：`kill <pid>` 后自动以 `~/.mindx/bin/mindx daemon` 重启（替换二进制再 kill 即可无感升级）。启动成功标志：日志 `gateway started successfully`。
4. **daemon 日志不记普通 RPC 查询**：只记 Ask 执行链路（`request: enqueuing`/`request done`）。验证 RPC 是否被前端调用要抓 WS 帧（playwright `page.on('websocket')` + `framereceived/framesent`）或 python 直连 `ws://localhost:1314/ws` 按 JSON-RPC 帧调。
5. **work 页面验证前先关弹层**：connectors 设置页的 Overlay mask（`[class*=mask]`）会挡住 `.ProseMirror` 输入区点击（force click 无效）。

## 实施结构（三端）

- **goharness**（`core/goharness/agents/`）：`subAgentManager.runningSessions()` + `Runtime.RunningSubAgentSessions()`——读 `sponsored` 登记表收集运行中子会话 ID。**待发布新版本**（v0.2.49+）后 mindx 才能去掉本地 replace 正式构建。
- **mindx daemon**（`internal/svc/`）：新 RPC `session.statuses`（handler_session.go `handleSessionStatuses` + handler_registry.go 注册）——遍历 `sessionQueues`（running 的主会话）+ `ForEachRuntime` 收集子会话，返回 `[{session_id, kind: main|sub}]`。
- **mindx-work**（`plugins/src/chatflow/store.ts`）：
  - `refreshRunningSessions()`：调 RPC 对齐 `busySessions`；diff 熄灭只清「上一轮报告过又消失」的会话（`lastRunningReport` Set），避免误清本端 sendMessage 在途窗口的本地 busy。
  - `watch(isConnected, {immediate})`：连接即对齐 + 5s 间隔轮询，断开停表。
  - `message_queued/processing` 放开 busySessions 激活过滤（isQueued 仍限激活会话）；`subtask_spawned/completed` 置/清子会话 busy。
  - UI 零改动：TasksSection 呼吸动画与 ChatInput 停止态都读 `isBusy(sessionId)` → `busySessions`。

## 验证证据（CDP）

- python 直调 RPC 返回 `{"result": []}`（空闲）。
- 发消息后 1s：侧栏 breathing 2 处（任务分组行图标 + 最近讨论行头像）+ ChatInput 停止态；结束后 breathing 0 熄灭。
- WS 帧抓到前端 12s 内发 3 帧 `session.statuses`（immediate + 2 周期）。
