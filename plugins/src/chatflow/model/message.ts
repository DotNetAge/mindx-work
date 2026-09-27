// ChatMessage / ChatRound 类型投影（源：mindx-desktop stores/chatStore.ts，字段逐一核对）。
//
// ChatFlow 一期只做类型投影：builder 与后续 store 消费同一形状的消息流。
// 会话状态逻辑不在此平移（ChatFlow store 四期重写）。

/** 消息角色（与 daemon 会话消息流对齐） */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/**
 * 会话消息：daemon 消息事件的渲染侧统一形状。
 * - eventType：事件归一标记（thinking_delta / tool_exec / subtask_spawned /
 *   permission_request / form / error / compaction / max_turns_reached / llm_retry /
 *   llm_cancelled / content_delta / markdown / task_summary / final_answer …），
 *   builder 按此分派节点族；
 * - eventData：事件载荷（工具事件为 { start, end, status } 形状，builder 逐字段投影）；
 * - tokenUsage / actualTokens / cost：消息级用量（goharness 富化），content 节点汇总为 TurnUsage。
 */
export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: string
  eventType?: string
  eventTitle?: string
  eventData?: any
  metadata?: Record<string, any>
  sessionId: string
  agentName?: string
  /** 用户消息携带的图片（path 指向会话临时目录中的落盘文件） */
  images?: Array<{
    path?: string
    media_type?: string
    base64_data?: string
    alt_text?: string
  }>
  /** 单条消息的 LLM 用量 */
  tokenUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cached_tokens?: number
    reasoning_tokens?: number
    /** 本条消息所汇总的 LLM 调用次数（恢复历史会话时中间调用合并到最终回复消息上） */
    call_count?: number
  }
  /** 净 tokens（prompt + completion − cached），goharness 富化 */
  actualTokens?: number
  /** 本条消息成本（goharness 富化） */
  cost?: number
}

/**
 * 一轮对话的聚合结构（以 user 消息为轮次边界）：
 * builder 的 RoundInput 即 { key, messages, isFinal } 投影，
 * isFinal 由 hasFinalAnswer / 会话收尾信号驱动。
 */
export interface ChatRound {
  /** 轮次唯一 key（用 user 消息 id；前导轮用 prelude_ 前缀） */
  key: string
  /** 用户问题（轮次容器头）；消息流开头无 user 消息时为 null（前导轮） */
  userMessage: ChatMessage | null
  /** 本轮全部消息（保持原始顺序） */
  messages: ChatMessage[]
  /** 本轮是否已产生最终答案（finish_reason=stop 或 task_summary/final_answer 消息） */
  hasFinalAnswer: boolean
}

/**
 * daemon 会话快照消息（session.get 返回的 messages 条目；
 * desktop types/websocket.ts SessionMessage 字段逐一核对，移植计划附录 C.3）。
 * timestamp 为秒级数值（restore 时转 ISO 字符串）。
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** 思考流（DeepSeek-R1 等，内嵌于 assistant 消息） */
  reasoning_content?: string
  timestamp: number
  /** 用户消息携带的图片内容块（path 指向会话临时目录中的落盘文件） */
  images?: Array<{
    path?: string
    media_type?: string
    base64_data?: string
    alt_text?: string
  }>
  /** role="tool" 结果消息按 tool_call_id 归位 */
  tool_call_id?: string
  /** assistant 工具调用（goharness 扁平格式，arguments 为 JSON 字符串） */
  tool_calls?: Array<{
    id: string
    name: string
    arguments: string
  }>
  /** OpenAI 协议原值终止原因（仅 assistant）：'stop'（最终回答）| 'tool_calls' | 'length' | 'content_filter' */
  finish_reason?: string
  token_usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cached_tokens?: number
    reasoning_tokens?: number
  }
  /** 净 tokens（prompt + completion − cached），goharness 富化 */
  actual_tokens?: number
  cost?: number
}

/**
 * 从 LLM HTTP 错误文本识别类型（源 chatStore.classifyHttpError 语义平移）。
 * gochat 的 APIError 结构化 StatusCode/Type 在 goharness 字符串化时丢失，
 * 只能从错误文本模式匹配。返回 'rate_limit' | 'timeout' | 'overloaded' | 'server' |
 * 'auth' | 'payment' | 'forbidden' | 'not_found' | 'validation' | ''（未识别）。
 */
export function classifyHttpError(content: string): string {
  const s = (content || '').toLowerCase()
  // ── 可重试：限流 ──
  if (/(\b429\b|rate[_ -]?limit|too many requests|throttl|quota)/.test(s)) return 'rate_limit'
  // ── 可重试：超时（408 请求超时 / 504 网关超时）──
  if (/(\b408\b|\b504\b|timeout|timed out|gateway timeout)/.test(s)) return 'timeout'
  // ── 可重试：过载（Anthropic 529 overloaded）──
  if (/(\b529\b|overload)/.test(s)) return 'overloaded'
  // ── 可重试：服务端 5xx（500/502/503…）──
  if (/(\b5\d\d\b|internal server error|bad gateway|service unavailable|server error|unavailable)/.test(s)) return 'server'
  // ── 不可重试：认证（401）──
  if (/(\b401\b|unauthorized|invalid.*api.?key|authentication)/.test(s)) return 'auth'
  // ── 不可重试：计费（402 / 欠费 / 额度）──
  if (/(\b402\b|insufficient|balance|billing|payment|pay[_-]?as[_-]?you[_-]?go|quota.*exceed|access[_ -]?denied)/.test(s)) return 'payment'
  // ── 不可重试：权限（403）──
  if (/(\b403\b|forbidden|permission|not supported|suspended)/.test(s)) return 'forbidden'
  // ── 不可重试：资源不存在（404）──
  if (/(\b404\b|not found|does not exist)/.test(s)) return 'not_found'
  // ── 不可重试：请求 / 校验（400 / 422）──
  if (/(\b400\b|\b422\b|invalid request|malformed|context length|too long|exceed.*length)/.test(s)) return 'validation'
  return ''
}
