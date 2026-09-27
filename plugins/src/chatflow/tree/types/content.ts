// 族 1：执行内容节点（3 种）——content / thinking / group。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §2.2 族 1。
// 节点 = assistant 消息的视图切面：content 节点对应消息 Content 字段、
// thinking 节点对应 ReasoningContent 字段——不按 FinishReason 拆分节点类型，
// 叙述/答案只是 content 节点的状态分支（取舍 5）。

import type { GroupKey, NodeBase } from './base'

/**
 * content 节点的一次轮内用量快照（聚合自消息级 tokenUsage，轮跨度口径），
 * 供最终答案形态的用量徽标与轮 footer 复用。
 */
export interface TurnUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  /** 扣除缓存后的净用量 */
  actualTokens: number
  /** 汇总的 LLM 调用次数 */
  callCount: number
  cost: number
}

/**
 * 会话上下文用量（desktop connectionStore.contextUsage 同源，session.context RPC 投影）。
 * RoundFooter Context ring 的数据源——work connection 插件暂无该服务，
 * 由使用方经 props 注入（禁止猜测服务协议，四期接 RPC 后原样传递）。
 */
export interface ContextUsageInfo {
  window_tokens: number
  max_window_size: number
  usage_ratio: number
  message_count: number
  cursor: number
  active_message_count: number
  total_actual_tokens: number
  total_cost: number
}

/**
 * 输出内容节点（单一类型，状态驱动样式分支，取舍 5）：
 * - 'streaming'：ContentDelta 流入中、未定稿（executing 名片 = 「正在规划下一步」流光）；
 * - 'tool_calls'：过程段（该迭代以工具调用收尾，中间叙述）；
 * - 'stop'：最终答案（实时由 final_answer 事件定稿；恢复态按持久化 finish_reason 判定）。
 * 定稿为 stop 时渲染轮尾答案形态并携带 turnUsage / summary（summary ← task_summary）。
 */
export type ContentFinishReason = 'streaming' | 'tool_calls' | 'stop'

export interface ContentNode extends NodeBase {
  type: 'content'
  content: string
  finishReason: ContentFinishReason
  turnUsage?: TurnUsage
  summary?: string
}

/** 思考节点：一段推理流（ReasoningContent 字段的视图切面），展开态复用 ThinkingView */
export interface ThinkingNode extends NodeBase {
  type: 'thinking'
  content: string
}

/**
 * 分组节点：构建器对「相邻同 groupKey 工具段」的归一化产物（§2.3）。
 * 组头 summarize(n) 由成员类型推导（registry/summary.ts），零特判。
 * children 仅含工具节点——树深约束 ≤2 的结构保证（子会话禁派孙）。
 */
export interface GroupNode extends NodeBase {
  type: 'group'
  groupKey: GroupKey
  children: import('./tool').ToolNode[]
}
