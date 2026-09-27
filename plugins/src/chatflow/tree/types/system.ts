// 族 3：阻塞与系统节点（7 种）——permission / ask_user / error / compaction / max_turns / llm_retry / cancelled。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §2.2 族 3 与归一规则 5/8/10。
// - permission：permission_request + permission_denied 都落此节点（denied 记决定），
//   请求 + 决定 = 完整审计闭环；前端协议单轨（RespPermissionRequest）；
// - ask_user：AskUser 工具落此节点（不落普通工具节点，归一规则 4）；
// - error：error / llm_timeout 落此节点，payload.source 区分（含服务商 402 欠费路径，归一规则 10）；
//   error 是阻断节点——轮态 halted，活跃路径自动展开，重试/忽略操作就位（§3.6）。

import type { NodeBase } from './base'

/**
 * 授权留痕节点。decision 记录审批决定：
 * - 'pending'：阻塞中（交互在吸底 Drawer，此处是时间线上的留痕占位）；
 * - 'granted' / 'session-granted' / 'denied'：决定已下，审计闭环。
 */
export interface PermissionNode extends NodeBase {
  type: 'permission'
  toolName: string
  /** 参数摘要（名片一句话展示，builder 从结构化 params 精选生成） */
  paramsDigest: string
  decision: 'pending' | 'granted' | 'session-granted' | 'denied'
  reason?: string
  securityLevel: string
  /** 子会话授权路由（PermissionSink 旁路广播携带 session_id） */
  sessionId?: string
}

/** AskUser 单个问题（RespForm Questions 投影） */
export interface AskUserQuestion {
  question: string
  options?: string[]
  multiSelect?: boolean
}

/** AskUser 单个回答（与 questions 按序对应） */
export interface AskUserAnswer {
  question: string
  answer: string
}

/** 向用户提问卡（阻塞原语留痕；回答后名片显示「已回答：<选项>」） */
export interface AskUserNode extends NodeBase {
  type: 'ask_user'
  questions: AskUserQuestion[]
  answers: AskUserAnswer[]
}

/** 错误来源：运行时错误 / LLM 请求超时 / 服务商 402 欠费（归一规则 10） */
export type ErrorNodeSource = 'runtime' | 'llm_timeout' | 'provider_402'

/** 错误卡（阻断节点：执行停在错误处，轮态 halted，重试前时间线不再前进） */
export interface ErrorNode extends NodeBase {
  type: 'error'
  message: string
  source: ErrorNodeSource
  /** HTTP 错误分类（classifyHttpError 的识别结果，供 ErrorView 恢复策略展示） */
  httpClass?: string
  /** 原始错误详情（展开态 ErrorView details） */
  details?: string
}

/** 上下文压缩卡 */
export interface CompactionNode extends NodeBase {
  type: 'compaction'
  messagesSlid: number
  /** 压缩后剩余窗口 tokens */
  remainingAfter: number
  /** 窗口上限（模型上下文长度） */
  windowSize: number
}

/** 达到最大轮数卡 */
export interface MaxTurnsNode extends NodeBase {
  type: 'max_turns'
  turnsCompleted: number
  maxTurns: number
  suggestion?: string
}

/** LLM 建流重试卡（自动重试不阻断，attention 黄；重试最终失败才升级为阻断 error） */
export interface LlmRetryNode extends NodeBase {
  type: 'llm_retry'
  provider: string
  model?: string
  statusCode?: number
  attempt: number
  maxAttempts: number
  retryAfterMs?: number
  error?: string
}

/** 用户中断卡（按停止 / 断开连接；一行卡，无展开态） */
export interface CancelledNode extends NodeBase {
  type: 'cancelled'
  by: 'user'
  /** 中断时已执行时长（llm_cancelled.elapsed_ns 投影） */
  elapsedMs?: number
}
