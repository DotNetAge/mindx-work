# 状态残留-回hero态重置清单与用量环误判加载态

日期：2026-10-05
现象：新建任务后输入区"上下文用量环"仍显示旧会话 2%（用户截图注解"新建任务后不同步"）。

## 根因

`chatflow/store.ts` 的 `clearActiveStream()` 是"回 hero 空会话态"的唯一收口（新建任务入口 TasksSection / deleteSession / 切目录无命中三处调用），但它只清 `activeSessionId`/`isProcessing`/`isQueued`/`isRestoringSession`，漏清 `contextUsage`。而 `ChatFlowPage.contextUsage` computed 优先返回 `store.contextUsage`（真实会话用量投影），残留值直接进 UI。

修复：`clearActiveStream()` 补 `contextUsage.value = null`。hero 态由 ChatFlowPage 的模型 context_length 零值兜底（用户要求指示器常驻）；新会话建立后 fetchContextUsage / context_usage 事件填充（均有 `sid === activeSessionId` 守卫，无串话风险）。

## 经验

1. **ProgressRing 空环 + 小百分比在截图中像 spinner**：用户圈"转圈"要先辨认同位置的真实组件（ContextUsageGauge 的 2% 环），不要顺着"加载不同步"的字面往请求方向查。
2. **回 hero 态是会话级状态的重置收口**：此后新增会话级状态（用量、待确认文件、子会话流等）时，必须自查是否需要加入 clearActiveStream 的重置清单——`switchToSession` 有对称清空（contextUsage 已清），`clearActiveStream` 漏了，两个回退路径不同步就是这类 bug 的模板。
3. 定位顺序：截图注解 → 找组件（MindX Work 在 mindx-work 仓库 plugins/src/chatflow，不是 mindx-desktop）→ 查数据源的清空时机。
