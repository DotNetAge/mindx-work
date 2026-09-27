// 对话树构建器：轮内按时间有序的消息流 → 类型化节点树（纯函数 + 按轮记忆化）。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §5 构建规则、§2.2 归一规则、取舍 14。
// - 实时增量与历史恢复走同一构建路径（恢复态可审计性与实时一致）；
// - 按轮记忆化：历史轮的消息数未变则复用缓存的节点树，仅活跃轮全量重建
//   （流式 delta 高频变载，历史轮全量重建会使全子树重渲染，长会话流式必卡）；
// - 构建器产出类型化节点后 raw eventData 不外泄，下游不得重新解析原始事件；
// - 无法归入 32 种节点类型的残余消息（归一规则 7：execution_summary 等）进
//   residual 交还轮渲染层默认分支，审计不丢内容。
//
// 记忆化与实体 upsert 的响应式说明：缓存节点以 reactive 代理持有——task/subagent
// 实体节点按 taskId/sessionId 幂等 upsert（首次创建位置固定，后续原位更新），
// 活跃轮的更新会原地改写历史轮缓存中的实体节点，reactive 代理保证定向重渲染。

import { reactive } from 'vue'
import type { ChatMessage } from '../../model/message'
import type { PersistedSubtask } from '../../model/subtask'
import type { ContentFinishReason, ContentNode, ThinkingNode, TurnUsage } from '../types/content'
import type { CollectNode, SubagentNode, TaskNode, TaskSnapshotItem, TeamMember, TeamNode } from '../types/entity'
import type {
  AskUserNode, AskUserQuestion, CancelledNode, CompactionNode, ErrorNode,
  LlmRetryNode, MaxTurnsNode, PermissionNode,
} from '../types/system'
import type { ToolNode } from '../types/tool'
import type { ContributedToolNode } from '../../slot/types'
import { slotNodeTypeOfTool } from '../../slot/registry'
import type { NodeStatus, TreeNode } from '../types'
import { COLLECT_TOOL, SUBAGENT_TOOL, TASK_UPSERT_TOOLS, TEAM_CREATE_TOOL, TOOL_DESCRIPTOR_MAP } from './tool-map'
import { flushGroupBuffer, type GroupBuffer, pushToGroupBuffer } from './groupBuffer'
import { mergePersistedSubtasks } from './restore'

// ── 输入/输出契约 ──────────────────────────────────────────────────────────

/** 单轮构建输入（数据层 ChatRound 的投影，builder 不依赖 store 运行时） */
export interface RoundInput {
  /** 轮次唯一 key（user 消息 id） */
  key: string
  /** 本轮全部消息（含轮首 user 消息，保持原始顺序） */
  messages: ChatMessage[]
  /** 轮是否已收尾（实时 = sessionLoopEnded；恢复 = hasFinalAnswer）：
   *  驱动末段 content 定稿为 stop（final_answer 事件定稿语义） */
  isFinal: boolean
}

/** 单轮构建输出 */
export interface RoundTree {
  roundKey: string
  nodes: TreeNode[]
  /** 无法归入节点类型的残余消息（轮渲染层默认分支兜底，审计不丢内容） */
  residual: ChatMessage[]
}

export interface BuildTreesOptions {
  /** localStorage 子任务登记（model/subtask），恢复三路合成的旁路数据源 */
  persistedSubtasks?: PersistedSubtask[]
  /** 子会话消息流（子会话 ID → 消息数组，ChatFlow store 取）：
   *  工作块 E 内联直播的数据源——subagent 节点按子会话流归一化出嵌套 children */
  subagentStreams?: Record<string, ChatMessage[]>
}

// ── 会话级构建状态（记忆化 + 实体 upsert 注册表）───────────────────────────

export interface SessionBuildState {
  /** 按轮记忆化：roundKey → { 消息数, 终结标志, 节点树, 残余 } */
  memo: Map<string, { count: number; isFinal: boolean; nodes: TreeNode[]; residual: ChatMessage[] }>
  /** task 实体注册表：taskId → 节点（首次创建位置固定，后续原位更新） */
  taskNodes: Map<string, TaskNode>
  /** subagent 实体注册表：子会话 ID → 节点 */
  subagentNodes: Map<string, SubagentNode>
  /** 子会话流归一化记忆化：子会话 ID → { 消息数, 嵌套节点 }（流式 delta 高频变载，避免每 pass 重建） */
  subStreamMemo: Map<string, { count: number; nodes: TreeNode[] }>
  /** 任务看板当前快照（TaskCreate/Update/List 事件驱动，upsert 时留档） */
  taskBoard: TaskSnapshotItem[]
}

const sessionStates = new Map<string, SessionBuildState>()

function getSessionState(sessionId: string): SessionBuildState {
  let s = sessionStates.get(sessionId)
  if (!s) {
    s = { memo: new Map(), taskNodes: new Map(), subagentNodes: new Map(), subStreamMemo: new Map(), taskBoard: [] }
    sessionStates.set(sessionId, s)
  }
  return s
}

/** 清空会话构建状态（会话切换/消息清空时由 store 调用，防串话与内存泄漏） */
export function clearTreeBuildState(sessionId: string): void {
  sessionStates.delete(sessionId)
}

/**
 * 缓存命中轮的实体回扫登记：把缓存树中的 task / subagent 节点重新挂回注册表。
 * 注册表每 pass 重建（见 buildTreesForRounds），跨轮 upsert（后轮更新前轮创建的实体）
 * 依赖缓存轮的实体在注册表中可寻址；group 的 children 仅含工具节点，无需下钻。
 */
function registerEntities(state: SessionBuildState, nodes: TreeNode[]): void {
  for (const node of nodes) {
    if (node.type === 'task') {
      if (!state.taskNodes.has(node.taskId)) state.taskNodes.set(node.taskId, node)
    } else if (node.type === 'subagent') {
      const key = subagentKey(node.sessionId || '', node.agentName)
      if (key && !state.subagentNodes.has(key)) {
        state.subagentNodes.set(key, node)
        // 别名键随节点回扫登记：重建 pass 后 tool_exec_start（无 session_id）
        // 仍能按 agent 名命中缓存轮的节点，不裂出新卡
        if (node.sessionId && node.agentName) {
          state.subagentNodes.set(`name:${node.agentName}`, node)
        }
      }
    }
  }
}

// ── 主流程：多轮构建 + 按轮记忆化 ─────────────────────────────────────────

/**
 * 构建一个会话全部轮次的节点树。
 * 历史轮（非末轮且消息数未变）复用缓存；末轮每 pass 全量重建（单轮量级毫秒级）。
 */
export function buildTreesForRounds(
  sessionId: string,
  rounds: RoundInput[],
  opts?: BuildTreesOptions
): RoundTree[] {
  const state = getSessionState(sessionId)
  const results: RoundTree[] = []

  // 实体注册表每 pass 重建：只登记「本轮构建中真实可见于某个轮」的实体节点，
  // 防止重载/轮键变化后旧注册表持有游离节点（upsert 合并进不可见节点导致实体卡丢失）。
  // 缓存命中轮的实体节点从缓存树回扫登记，跨轮 upsert（后轮更新前轮创建的实体）照常生效。
  state.taskNodes.clear()
  state.subagentNodes.clear()
  // 看板快照跟随缓存生命周期：会话级全新重建（缓存为空）时一并清空，防重载后残留旧任务
  if (state.memo.size === 0) {
    state.taskBoard = []
    state.subStreamMemo.clear()
  }

  for (let ri = 0; ri < rounds.length; ri++) {
    const round = rounds[ri]!
    const isLast = ri === rounds.length - 1
    const cached = state.memo.get(round.key)
    // 记忆化命中：历史轮消息数未变且终结标志一致 → 复用。末轮始终重建（实时流式原地变载）。
    // isFinal 一致性：轮从进行中转为终结（如 AskUser 回答后开启新轮）必须重建，
    // 否则缓存中的 form 节点会永久停留在 executing 流光态。
    if (!isLast && cached && cached.count === round.messages.length && cached.isFinal === round.isFinal) {
      registerEntities(state, cached.nodes)
      results.push({ roundKey: round.key, nodes: cached.nodes, residual: cached.residual })
      continue
    }
    const built = buildRound(state, round)
    state.memo.set(round.key, { count: round.messages.length, isFinal: round.isFinal, nodes: built.nodes, residual: built.residual })
    results.push(built)
  }

  // 防洪：轮键变化（回收本轮/重载）留下的陈旧缓存条目超限时整表重建
  if (state.memo.size > rounds.length + 20) {
    const valid = new Set(rounds.map(r => r.key))
    // Map 迭代中 delete 当前/后续条目均安全（迭代器跳过已删条目），无需展开快照
    for (const k of state.memo.keys()) {
      if (!valid.has(k)) state.memo.delete(k)
    }
  }

  // 恢复三路合成之三：localStorage 登记的子任务在快照中缺失（压缩滑出窗口）时补齐轮尾
  if (opts?.persistedSubtasks?.length) {
    mergePersistedSubtasks(results, state, opts.persistedSubtasks)
  }

  // 工作块 E：subagent 节点挂接子会话流嵌套节点（内联直播）。
  // 对全部轮统一执行（含缓存命中轮与补齐卡）：恢复场景下子会话流经 prefetch
  // 异步补齐，缓存轮不会再走 buildRound，必须在此挂接才能让恢复后的子代理
  // 全过程在主树内懒加载回看。必须在 merge 之后——补齐卡同样要挂接子会话流。
  if (opts?.subagentStreams) {
    for (const round of results) {
      attachSubagentStreams(state, round.nodes, opts.subagentStreams)
    }
  }

  return results
}

// ── 单轮构建 ──────────────────────────────────────────────────────────────

function buildRound(state: SessionBuildState, round: RoundInput): RoundTree {
  const msgs = round.messages
  // 轮起点时间戳：轮首消息（通常为 user）作为 startedAt 偏移基准
  const roundStart = msgs.length ? msgTs(msgs[0]!) : 0

  const nodes: TreeNode[] = []
  const residual: ChatMessage[] = []
  let buffer: GroupBuffer | null = null
  // 本轮未决的 permission 节点（阻塞授权的审计闭环：请求 + 决定 = 完整留痕）
  const openPermissions: PermissionNode[] = []

  const pushNode = (node: TreeNode | null) => {
    if (node) nodes.push(node)
  }
  // 任何非工具节点都是工具缓冲的边界：追加前冲掉缓冲
  const flushBefore = () => {
    if (buffer) {
      pushNode(flushGroupBuffer(buffer))
      buffer = null
    }
  }

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!
    if (m.role === 'user') continue // 轮首 user 消息由 UserMessageRow 渲染，不入树
    const et = m.eventType
    const offset = nodeOffset(m, roundStart)

    // ── 思考段（显式边界：thinking_done）──
    if (et === 'thinking_delta' || et === 'thinking_done') {
      if (!m.content || !m.content.trim()) continue
      flushBefore()
      pushNode(reactive({
        id: m.id,
        type: 'thinking',
        content: m.content,
        status: et === 'thinking_delta' ? 'executing' : 'success',
        startedAt: offset,
        durationMs: m.metadata?.duration_ms || undefined,
        foldDefault: true,
      } satisfies ThinkingNode))
      continue
    }

    // ── 内容段（content/markdown/task_summary/final_answer/恢复态 assistant）──
    if (et === 'content_delta' || et === 'markdown' || et === 'task_summary' || et === 'final_answer' || (!et && m.role === 'assistant')) {
      if (!m.content || !m.content.trim()) continue
      flushBefore()
      const finishReason = contentFinishReason(m, i, msgs.length, round.isFinal)
      pushNode(reactive({
        id: m.id,
        type: 'content',
        content: m.content,
        finishReason,
        status: finishReason === 'streaming' ? 'executing' : 'success',
        startedAt: offset,
        turnUsage: toTurnUsage(m),
        // task_summary 双语义归一（归一规则 8）：并入 content 节点
        summary: et === 'task_summary' ? m.content : undefined,
        tokens: m.tokenUsage?.total_tokens || undefined,
        foldDefault: false,
      } satisfies ContentNode))
      continue
    }

    // ── 工具执行 ──
    if (et === 'tool_exec' || et === 'tool_exec_start' || et === 'tool_exec_end') {
      const start = m.eventData?.start || {}
      const end = m.eventData?.end || {}
      const toolName = m.eventTitle || start.tool_name || end.tool_name || ''
      const params: Record<string, any> = (start.params && typeof start.params === 'object') ? start.params : {}

      // 归一规则 3：TaskCreate/TaskUpdate 不落工具节点，按 taskId 实体 upsert。
      // upsert 返回的节点必须 push 入树（首个 TaskCreate 位置定桩），后续 TaskUpdate
      // 原位更新已有节点，nodes.includes 去重防止重复 push——注册表只承担状态回填寻址。
      if (TASK_UPSERT_TOOLS.has(toolName)) {
        flushBefore()
        const node = upsertTaskNode(state, m, toolName, params, end, offset)
        if (node && !nodes.includes(node)) pushNode(node)
        continue
      }
      // 归一规则 3：TeamCreate 落 team 实体卡（登记型一次性动作，无后续更新，不进注册表）
      if (toolName === TEAM_CREATE_TOOL) {
        flushBefore()
        pushNode(buildTeamNode(m, params, offset))
        continue
      }
      // 归一规则 4/11：SubAgent 落 subagent（subtask 双事件 upsert 单卡片）。
      // upsert 返回的节点必须 push 入树：注册表只承担状态回填寻址，不是渲染源。
      // nodes.includes 去重：同一子任务的 spawn 消息与 tool_exec 消息都在主会话流
      // （实时态两路都到），首个来源入树，后续来源命中已有节点不再重复 push。
      if (toolName === SUBAGENT_TOOL) {
        flushBefore()
        const node = upsertSubagentFromTool(state, m, params, end, offset)
        if (node && !nodes.includes(node)) pushNode(node)
        continue
      }
      // 归一规则 4：CollectResults 落 collect
      if (toolName === COLLECT_TOOL) {
        flushBefore()
        pushNode(buildCollectNode(state, m, end, offset))
        continue
      }
      // AskUser 不产生 tool_exec 消息（store 层跳过），防御性忽略
      if (toolName === 'AskUser') continue

      const descriptor = TOOL_DESCRIPTOR_MAP[toolName]
      if (!descriptor) {
        // 槽位认领的贡献层工具（五期）：归一为贡献节点独立落卡（槽位无 groupKey 声明 → 不聚合）
        const slotKey = slotNodeTypeOfTool(toolName)
        if (slotKey) {
          flushBefore()
          // 授权审计闭环与内建工具同语义：同工具名实际执行即关闭未决授权
          closeOpenPermission(openPermissions, toolName, 'granted', 'success')
          // 贡献节点不进内建 32 型判别联合（四表穷举保留），单点结构断言入树
          pushNode(buildContributedToolNode(slotKey, toolName, params, end, m, offset) as unknown as TreeNode)
          continue
        }
        // 未登记工具（新增工具未补对照表且无槽位认领）：降级进残余消息，不私加节点类型
        console.warn('[tree/builder] 未登记的工具，先补工具对照表再写码:', toolName)
        residual.push(m)
        continue
      }

      // 授权审计闭环：同工具名的未决授权在此工具实际执行时关闭为 granted
      closeOpenPermission(openPermissions, toolName, 'granted', 'success')

      const toolNode = buildToolNode(descriptor.nodeType, toolName, params, end, m, offset)
      // TaskList 查询结果是看板快照的权威来源：顺带刷新（供 task 实体卡快照留档）
      if (toolName === 'TaskList' && toolNode.status !== 'executing') {
        const board = parseResultJson(end.result)
        if (board) refreshBoardFromList(state, board)
      }
      // 关键动作（groupKey=null，如 Skill）不聚合：冲刷既有缓冲后独立落卡。
      // 缺陷修复（五期勘察探针实证）：原路径经 pushToGroupBuffer 的 null 分支只冲刷旧
      // 缓冲，节点本体无人 push——Skill 等关键动作痕迹整体丢失（回归断言见
      // scripts/chatflow-builder.spec.mjs 关键动作落卡用例）。
      if (descriptor.groupKey === null) {
        flushBefore()
        pushNode(toolNode)
        continue
      }
      const result = pushToGroupBuffer(buffer, toolNode, descriptor.groupKey)
      if (result.flushed) pushNode(result.flushed)
      buffer = result.buffer
      continue
    }

    // ── subtask 双事件 upsert 单卡片（归一规则 11）──
    if (et === 'subtask_spawned') {
      flushBefore()
      const node = upsertSubagentFromSpawn(state, m, offset)
      if (node && !nodes.includes(node)) pushNode(node)
      continue
    }
    if (et === 'subtask_completed') {
      flushBefore()
      applySubtaskCompletion(state, m)
      continue
    }

    // ── 阻塞与系统事件 ──
    if (et === 'permission_request') {
      flushBefore()
      const node = buildPermissionPending(m, offset)
      openPermissions.push(node)
      pushNode(node)
      continue
    }
    if (et === 'permission_denied') {
      flushBefore()
      // 载荷可能是纯字符串（拒绝原因）：此时按「任意未决授权」闭合，
      // 不能把理由串当工具名去比对——否则 pending 永不闭合、拒绝留痕翻倍
      const d = m.eventData
      const deniedTool = (d && typeof d === 'object') ? str(d.tool_name ?? d.toolName) : ''
      const closed = closeOpenPermission(openPermissions, deniedTool, 'denied', 'failed')
      if (!closed) {
        // 无对应未决授权（旧数据/跨轮拒绝）：落独立拒绝留痕节点
        pushNode(buildPermissionDenied(m, offset))
      }
      continue
    }
    if (et === 'form') {
      flushBefore()
      pushNode(buildAskUserNode(m, offset, !round.isFinal))
      continue
    }
    if (et === 'error') {
      flushBefore()
      pushNode(buildErrorNode(m, offset))
      continue
    }
    if (et === 'compaction') {
      flushBefore()
      pushNode(buildCompactionNode(m, offset))
      continue
    }
    if (et === 'max_turns_reached') {
      flushBefore()
      pushNode(buildMaxTurnsNode(m, offset))
      continue
    }
    if (et === 'llm_retry') {
      flushBefore()
      pushNode(buildLlmRetryNode(m, offset))
      continue
    }
    if (et === 'llm_cancelled') {
      flushBefore()
      pushNode(buildCancelledNode(m, offset))
      continue
    }

    // 其余消息（系统杂项等）：残余兜底，不私加节点类型
    residual.push(m)
  }

  // 轮尾冲刷工具缓冲
  if (buffer) {
    pushNode(flushGroupBuffer(buffer))
    buffer = null
  }

  return { roundKey: round.key, nodes, residual }
}

// ── 子会话流内联直播（工作块 E）────────────────────────────────────────────

/**
 * 把子会话消息流归一化为 subagent 节点的嵌套 children。
 * 复用 buildRound 的消息归一化循环（thinking/content/tool/subtask/阻塞事件全部同构），
 * 用独立的构建状态隔离孙代理实体注册表；残余消息不进树（子会话 Tab 仍有完整数据）。
 */
function buildSubagentChildren(messages: ChatMessage[], subFinal: boolean): TreeNode[] {
  const childState: SessionBuildState = {
    memo: new Map(),
    taskNodes: new Map(),
    subagentNodes: new Map(),
    subStreamMemo: new Map(),
    taskBoard: [],
  }
  const built = buildRound(childState, { key: 'sub_stream', messages, isFinal: subFinal })
  return built.nodes
}

/**
 * 为本轮全部 subagent 节点挂接 children（按子会话流记忆化，流式 delta 只在
 * 消息数变化时重建）。末轮每 pass 重建时节点是新建的 reactive 代理，children
 * 数组从记忆化缓存引用，保证节点对象原地更新触发定向重渲染。
 */
function attachSubagentStreams(
  state: SessionBuildState,
  nodes: TreeNode[],
  streams: Record<string, ChatMessage[]>
): void {
  for (const node of nodes) {
    if (node.type !== 'subagent' || !node.sessionId) continue
    const flow = streams[node.sessionId]
    if (!flow || flow.length === 0) continue
    const cached = state.subStreamMemo.get(node.sessionId)
    if (cached && cached.count === flow.length) {
      node.children = cached.nodes.length ? cached.nodes : undefined
      continue
    }
    // 子会话是否已收尾：节点状态是权威来源（CollectResults/完成事件回填），
    // 兜底检查子会话流尾部的完成/失败事件（跨 pass 重建时节点可能是新建的）
    const last = flow[flow.length - 1]
    const tailSettled = last?.eventType === 'subtask_completed' || last?.eventType === 'error'
    const subFinal = node.status !== 'executing' || tailSettled
    const children = buildSubagentChildren(flow, subFinal)
    state.subStreamMemo.set(node.sessionId, { count: flow.length, nodes: children })
    node.children = children.length ? children : undefined
  }
}

// ── 节点构造：时间 ─────────────────────────────────────────────────────────

/** 消息时间戳（ms）；无有效时间返回 0 */
function msgTs(m: ChatMessage): number {
  const t = Date.parse(m.timestamp)
  return Number.isFinite(t) ? t : 0
}

/** 节点 startedAt：轮内偏移 ms（相对轮首），负值钳为 0 */
function nodeOffset(m: ChatMessage, roundStart: number): number {
  if (!roundStart) return 0
  return Math.max(0, msgTs(m) - roundStart)
}

// ── 节点构造：族 1 执行内容 ───────────────────────────────────────────────

/**
 * content 节点的 finishReason 判定（取舍 5：单一类型状态驱动分支）：
 * - 恢复态显式 stop / task_summary / final_answer → 'stop'（最终答案定稿）；
 * - 恢复态过程段（is_reasoning）→ 'tool_calls'；
 * - 实时段：后面还有消息 → 已被后续边界事件冲刷为过程段；是末条 → 按轮收尾信号判定。
 */
function contentFinishReason(m: ChatMessage, index: number, total: number, isFinal: boolean): ContentFinishReason {
  if (m.metadata?.finish_reason === 'stop') return 'stop'
  if (m.eventType === 'task_summary' || m.eventType === 'final_answer') return 'stop'
  if (m.metadata?.is_reasoning) return 'tool_calls'
  // 恢复的历史最终回答：无 eventType 的 assistant 消息，无 finish_reason 透传时按位置兜底
  if (!m.eventType && m.role === 'assistant') {
    return (index === total - 1 && isFinal) ? 'stop' : 'tool_calls'
  }
  if (index < total - 1) return 'tool_calls'
  return isFinal ? 'stop' : 'streaming'
}

/** 消息级 tokenUsage → TurnUsage（轮跨度口径已在 store/恢复链路合并） */
function toTurnUsage(m: ChatMessage): TurnUsage | undefined {
  const u = m.tokenUsage
  if (!u) return undefined
  const pt = u.prompt_tokens || 0
  const ct = u.completion_tokens || 0
  const ca = u.cached_tokens || 0
  if (pt === 0 && ct === 0) return undefined
  return {
    promptTokens: pt,
    completionTokens: ct,
    totalTokens: u.total_tokens || pt + ct,
    cachedTokens: ca,
    actualTokens: Math.max(0, pt + ct - ca),
    callCount: u.call_count || 1,
    cost: m.cost || 0,
  }
}

// ── 节点构造：族 4 工具 ───────────────────────────────────────────────────

/** 结果文本尾段截取上限：daemon processResult 截断上限 25000，取尾段做展开态兜底显示 */
const OUTPUT_TAIL_LIMIT = 20000

function tailText(s: string, limit: number): string {
  return s.length <= limit ? s : s.slice(s.length - limit)
}

/**
 * 子任务结果摘要（collect 列表 / subagent 卡共用）：头部截取 + 行对齐 + 代码围栏配平。
 * 不用尾部截取——摘要要的是结果开头的结论清单；尾截会把行拦腰截断（条目从半句开始），
 * 还可能截在 ``` 围栏中间产生未闭合围栏，markdown 把剩余摘要整体吞进代码块。
 */
function digestText(s: unknown, limit = 200): string {
  const text = str(s)
  if (text.length <= limit) return text
  let cut = text.slice(0, limit)
  const nl = cut.lastIndexOf('\n')
  if (nl > 0) cut = cut.slice(0, nl) // 行对齐（首行超长时放行整行）
  if ((cut.match(/```/g) || []).length % 2 === 1) cut += '\n```' // 围栏配平
  return cut + ' …'
}

/**
 * 工具节点公共壳 + 按类型提取专有 payload。
 * 输入侧来自结构化 params（参数名已逐工具核对 goharness/mindx 工具实现），
 * 结果侧来自 daemon result_meta 旁路（取舍 13）；恢复态无 result_meta 时字段缺省，
 * 展开态由 outputTail 兜底。
 */
/**
 * 贡献层工具节点构造（五期槽位机制）：槽位认领的工具名 → 通用贡献节点。
 * 不进内建 32 型判别联合（内建四表穷举保留）；渲染分派 / 名片呈现 / 操作声明由
 * 槽位注册表供给（贡献层优先、内建兜底）。params 结构化透传，贡献视图自行精选投影。
 */
function buildContributedToolNode(
  nodeType: string,
  toolName: string,
  params: Record<string, any>,
  end: any,
  m: ChatMessage,
  offset: number
): ContributedToolNode {
  const meta = (end.result_meta && typeof end.result_meta === 'object') ? end.result_meta : {}
  const status: NodeStatus = m.eventData?.status === 'executing' ? 'executing' : (m.eventData?.status === 'failed' ? 'failed' : 'success')
  const resultText = typeof end.result === 'string' ? end.result : ''
  return reactive({
    id: m.id,
    type: nodeType,
    toolName,
    params: params && typeof params === 'object' ? { ...params } : {},
    status,
    startedAt: offset,
    durationMs: end.duration_ms > 0 ? end.duration_ms : undefined,
    tokens: end.total_tokens > 0 ? end.total_tokens : undefined,
    resultMeta: Object.keys(meta).length ? meta : undefined,
    outputTail: resultText ? tailText(resultText, OUTPUT_TAIL_LIMIT) : undefined,
    approval: undefined,
    foldDefault: true,
  })
}

function buildToolNode(
  nodeType: ToolNode['type'],
  toolName: string,
  params: Record<string, any>,
  end: any,
  m: ChatMessage,
  offset: number
): ToolNode {
  const meta = (end.result_meta && typeof end.result_meta === 'object') ? end.result_meta : {}
  const status: NodeStatus = m.eventData?.status === 'executing' ? 'executing' : (m.eventData?.status === 'failed' ? 'failed' : 'success')
  const resultText = typeof end.result === 'string' ? end.result : ''
  const common = {
    id: m.id,
    toolName,
    status,
    startedAt: offset,
    durationMs: end.duration_ms > 0 ? end.duration_ms : undefined,
    tokens: end.total_tokens > 0 ? end.total_tokens : undefined,
    resultMeta: Object.keys(meta).length ? meta : undefined,
    outputTail: resultText ? tailText(resultText, OUTPUT_TAIL_LIMIT) : undefined,
    approval: undefined,
    foldDefault: true,
  }

  switch (nodeType) {
    case 'tool.read': {
      // read 不落地文件内容（内容展示太耗 DOM，文件查看走编辑器），outputTail 置空；
      // 节点只携带元信息（路径/行数/格式），供名片行与悬浮显示
      return reactive({
        ...common, type: 'tool.read',
        outputTail: undefined,
        path: str(params.filePath ?? params.file_path ?? params.path),
        offset: num(params.offset), limit: num(params.limit),
        lines: num(meta.lines_read), totalLines: num(meta.total_lines),
        format: meta.format as 'text' | 'image' | 'doc' | undefined,
      } satisfies ToolNode)
    }
    case 'tool.write':
      return reactive({
        ...common, type: 'tool.write',
        filePath: str(params.filePath ?? params.file_path),
        writeType: meta.write_type as 'create' | 'overwrite' | 'append' | undefined,
        bytesWritten: num(meta.bytes_written),
        additions: num(meta.additions), deletions: num(meta.deletions),
        // 结果即 unified diff（daemon 8KB 门槛内全量），供轮聚合现算 ± 行数兜底
        diff: resultText || undefined,
      } satisfies ToolNode)
    case 'tool.edit':
      return reactive({
        ...common, type: 'tool.edit',
        filePath: str(params.file_path ?? params.filePath),
        replaceCount: num(meta.replace_count), replaceMode: strOrUndef(meta.replace_mode),
        additions: num(meta.additions), deletions: num(meta.deletions),
        diff: resultText || undefined,
      } satisfies ToolNode)
    case 'tool.ls':
      return reactive({
        ...common, type: 'tool.ls',
        path: str(params.path), recursive: !!params.recursive,
        entryCount: num(meta.entry_count),
      } satisfies ToolNode)
    case 'tool.glob':
      return reactive({
        ...common, type: 'tool.glob',
        pattern: str(params.pattern), path: strOrUndef(params.path),
        matchCount: num(meta.match_count),
      } satisfies ToolNode)
    case 'tool.grep':
      return reactive({
        ...common, type: 'tool.grep',
        pattern: str(params.pattern), include: strOrUndef(params.include),
        mode: strOrUndef(params.output_mode), hitCount: num(meta.hit_count),
      } satisfies ToolNode)
    case 'tool.bash':
      return reactive({
        ...common, type: 'tool.bash',
        command: str(params.command), workingDir: strOrUndef(params.working_dir),
        exitCode: num(meta.exit_code),
      } satisfies ToolNode)
    case 'tool.run_script':
      return reactive({
        ...common, type: 'tool.run_script',
        skillName: str(params.skill ?? params.name), script: strOrUndef(params.command),
        args: strOrUndef(params.args), exitCode: num(meta.exit_code),
      } satisfies ToolNode)
    case 'tool.web_fetch':
      // 抓取正文不落地（outputTail 置空，省 DOM/内存），节点只带 url/title/bytes 元信息
      return reactive({
        ...common, type: 'tool.web_fetch',
        outputTail: undefined,
        url: str(params.url), title: strOrUndef(meta.title), bytes: num(meta.bytes),
      } satisfies ToolNode)
    case 'tool.web_search':
      return reactive({
        ...common, type: 'tool.web_search',
        query: str(params.query),
        engines: arrOfStr(meta.engines), failedEngines: arrOfStr(meta.failed_engines),
        cached: typeof meta.cached === 'boolean' ? meta.cached : undefined,
        resultCount: num(meta.result_count),
      } satisfies ToolNode)
    case 'tool.kb_search':
      return reactive({
        ...common, type: 'tool.kb_search',
        query: str(params.query), targetDir: strOrUndef(params.project_dir ?? params.target_dir),
        hitCount: num(meta.hit_count),
      } satisfies ToolNode)
    case 'tool.memory_search':
      return reactive({
        ...common, type: 'tool.memory_search',
        query: str(params.query), hitCount: num(meta.hit_count),
      } satisfies ToolNode)
    case 'tool.skill':
      return reactive({
        ...common, type: 'tool.skill',
        skillName: str(params.name), rootDir: strOrUndef(params.root_dir),
      } satisfies ToolNode)
    case 'tool.sleep':
      return reactive({
        ...common, type: 'tool.sleep',
        durationMs: num(params.duration_ms),
      } satisfies ToolNode)
    case 'tool.task_query':
      return reactive({
        ...common, type: 'tool.task_query',
        filters: pickDefined(params, ['status_filter', 'owner_filter', 'task_id']),
        resultDigest: undefined,
      } satisfies ToolNode)
    case 'tool.team_ops':
      return reactive({
        ...common, type: 'tool.team_ops',
        action: teamAction(toolName), teamName: strOrUndef(params.team_name),
        resultDigest: undefined,
      } satisfies ToolNode)
    case 'tool.cron':
      return reactive({
        ...common, type: 'tool.cron',
        action: str(params.action), cronId: strOrUndef(params.id), agent: strOrUndef(params.agent),
        cronExpr: strOrUndef(params.cron_expr),
        enabled: typeof params.enabled === 'boolean' ? params.enabled : undefined,
      } satisfies ToolNode)
    case 'tool.notify':
      return reactive({
        ...common, type: 'tool.notify',
        title: str(params.title), message: strOrUndef(params.message), subtitle: strOrUndef(params.subtitle),
      } satisfies ToolNode)
  }
}

// ── 节点构造：族 2 实体与协作 ─────────────────────────────────────────────

/** 安全解析工具结果 JSON（结果文本形态多样，失败返回 null） */
function parseResultJson(text: unknown): any | null {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * task 实体幂等 upsert（归一规则 3）：首次创建位置固定，后续原位更新状态与清单快照。
 * TaskList 查询结果同时刷新看板快照（权威来源）。
 */
function upsertTaskNode(
  state: SessionBuildState,
  m: ChatMessage,
  toolName: string,
  params: Record<string, any>,
  end: any,
  offset: number
): TaskNode | null {
  const failed = m.eventData?.status === 'failed'
  const parsed = parseResultJson(end.result)
  if (failed || !parsed) return null

  const taskId = str(parsed.task_id ?? params.task_id)
  if (!taskId) return null

  const existing = state.taskNodes.get(taskId)
  const patch = {
    subject: str(parsed.subject ?? params.subject),
    activeForm: strOrUndef(parsed.active_form ?? params.active_form),
    taskStatus: str(parsed.status ?? params.status) || 'pending',
  }

  if (!existing) {
    const node = reactive({
      id: `task_${taskId}`,
      type: 'task',
      taskId,
      subject: patch.subject,
      activeForm: patch.activeForm,
      taskStatus: patch.taskStatus,
      checklistSnapshot: cloneBoard(state.taskBoard),
      transitions: [],
      status: 'success',
      startedAt: offset,
      foldDefault: true,
    } satisfies TaskNode)
    state.taskNodes.set(taskId, node)
    refreshBoardOnUpsert(state, taskId, node)
    return node
  }
  // 幂等合并：重建场景下 TaskCreate 重复到达不重置已有状态
  if (patch.subject) existing.subject = patch.subject
  if (patch.activeForm) existing.activeForm = patch.activeForm
  if (patch.taskStatus && toolName === 'TaskUpdate') {
    if (patch.taskStatus !== existing.taskStatus) {
      // 流转记录去重：活跃轮重建每 pass 重放同一条 TaskUpdate，按（状态,时间）幂等
      const at = msgTs(m)
      const duplicated = existing.transitions.some(tr => tr.status === patch.taskStatus && tr.at === at)
      if (!duplicated) existing.transitions.push({ status: patch.taskStatus, at })
    }
    existing.taskStatus = patch.taskStatus
  }

  // 刷新看板快照并回填该节点
  refreshBoardOnUpsert(state, taskId, existing)
  return existing
}

/** TaskList 查询结果刷新看板快照（由工具节点构建路径调用） */
function refreshBoardFromList(state: SessionBuildState, parsed: any): void {
  const tasks = parsed?.tasks
  if (!Array.isArray(tasks)) return
  state.taskBoard = tasks.map((tk: any) => ({
    taskId: str(tk.task_id),
    subject: str(tk.subject),
    status: str(tk.status) || 'pending',
    activeForm: strOrUndef(tk.active_form),
  })).filter((t: TaskSnapshotItem) => t.taskId)
}

/** upsert 后同步看板快照中对应条目 */
function refreshBoardOnUpsert(state: SessionBuildState, taskId: string, node: TaskNode): void {
  const idx = state.taskBoard.findIndex(t => t.taskId === taskId)
  const item: TaskSnapshotItem = {
    taskId,
    subject: node.subject,
    status: node.taskStatus,
    activeForm: node.activeForm,
  }
  if (idx >= 0) state.taskBoard[idx] = item
  else state.taskBoard.push(item)
  node.checklistSnapshot = cloneBoard(state.taskBoard)
}

function cloneBoard(board: TaskSnapshotItem[]): TaskSnapshotItem[] {
  return board.map(t => ({ ...t }))
}

/**
 * team 实体卡（TeamCreate）：登记型一次性动作。
 * executing 阶段不落卡（快速动作，等结果一次成型）；失败保留失败留痕供审计。
 * 参数名已核对 goharness/tools/team_create.go（team_name/leader/members/description）。
 */
function buildTeamNode(m: ChatMessage, params: Record<string, any>, offset: number): TeamNode | null {
  const teamName = str(params.team_name)
  if (!teamName || m.eventData?.status === 'executing') return null
  const members: TeamMember[] = (Array.isArray(params.members) ? params.members : [])
    .map((v: unknown) => str(v))
    .filter(Boolean)
    .map(name => ({ name }))
  // leader 独立于 members 传参：补进成员列表并标注角色（已在列表中则原位标注）
  const leader = strOrUndef(params.leader)
  if (leader) {
    const hit = members.find(mm => mm.name === leader)
    if (hit) hit.role = 'leader'
    else members.unshift({ name: leader, role: 'leader' })
  }
  return reactive({
    id: `team_${m.id}`,
    type: 'team',
    teamName,
    members,
    description: strOrUndef(params.description),
    status: m.eventData?.status === 'failed' ? 'failed' : 'success',
    startedAt: offset,
    foldDefault: true,
  } satisfies TeamNode)
}

/**
 * subagent upsert（SubAgent 工具结果路径）：subtask 双事件的第一来源。
 * 真实时序上 executing 阶段先以 agent 名兜底键建卡，结果返回后拿 session_id 合并迁键。
 * 返回新建或命中的节点（调用方负责 push 入树）；无键可寻时返回 null。
 */
function upsertSubagentFromTool(
  state: SessionBuildState,
  m: ChatMessage,
  params: Record<string, any>,
  end: any,
  offset: number
): SubagentNode | null {
  const parsed = parseResultJson(end.result) || {}
  const sessionId = str(parsed.session_id)
  const agentName = str(parsed.agent_name ?? params.agent_name)
  const taskDigest = str(params.task)
  const key = subagentKey(sessionId, agentName)
  if (!key) return null

  const existing = findSubagentNode(state, sessionId, agentName)
  if (existing) {
    if (!existing.sessionId && sessionId) existing.sessionId = sessionId
    if (!existing.agentName && agentName) existing.agentName = agentName
    if (!existing.taskDigest && taskDigest) existing.taskDigest = taskDigest
    rekeySubagentNode(state, existing)
    return existing
  }
  const node = reactive({
    id: `subagent_${sessionId || m.id}`,
    type: 'subagent',
    agentName,
    taskDigest,
    sessionId: sessionId || undefined,
    status: 'executing',
    startedAt: offset,
    foldDefault: true,
  } satisfies SubagentNode)
  state.subagentNodes.set(key, node)
  return node
}

/**
 * subagent upsert（subtask_spawned 事件路径）：观察窗卡片的正式创建入口。
 * 返回新建或命中的节点（调用方负责 push 入树）；无键可寻时返回 null。
 * 命中分支无需 push（节点已在树中）；新建分支同时登记 agent 名别名键，
 * 让后续 tool_exec_start（结果未返回、拿不到 session_id）能命中同一节点防裂卡。
 */
function upsertSubagentFromSpawn(state: SessionBuildState, m: ChatMessage, offset: number): SubagentNode | null {
  const d = m.eventData || {}
  const sessionId = str(d.session_id)
  const agentName = str(d.agent_name)
  const key = subagentKey(sessionId, agentName)
  if (!key) return null // store 层同样丢弃缺字段事件，保持一致

  const existing = findSubagentNode(state, sessionId, agentName)
  if (existing) {
    if (!existing.sessionId && sessionId) existing.sessionId = sessionId
    if (!existing.agentName && agentName) existing.agentName = agentName
    if (!existing.taskDigest && str(d.description)) existing.taskDigest = str(d.description)
    rekeySubagentNode(state, existing)
    applySpawnCompletion(existing, d)
    return existing
  }
  const node = reactive({
    id: `subagent_${sessionId || m.id}`,
    type: 'subagent',
    agentName,
    taskDigest: str(d.description),
    sessionId: sessionId || undefined,
    status: 'executing',
    startedAt: offset,
    foldDefault: true,
  } satisfies SubagentNode)
  state.subagentNodes.set(key, node)
  if (sessionId && agentName) state.subagentNodes.set(`name:${agentName}`, node)
  applySpawnCompletion(node, d)
  return node
}

/**
 * spawn 消息携带的完成态回填：实时路径 CollectResults 的结果会由 store 原位写回
 * spawn 消息 eventData（success/answer/error），活跃轮重建重放该消息时据此恢复
 * 卡片完成态，避免重建后卡片退回「执行中」。
 */
function applySpawnCompletion(node: SubagentNode, d: Record<string, any>): void {
  if (typeof d.success !== 'boolean') return
  node.status = d.success ? 'success' : 'failed'
  const digest = digestText(d.success ? d.answer : d.error)
  if (digest) node.resultDigest = digest
}

/** subtask_completed（旧 markdown 恢复链路落在主会话流）：原位更新 subagent 卡片状态 */
function applySubtaskCompletion(state: SessionBuildState, m: ChatMessage): void {
  const d = m.eventData || {}
  const node = findSubagentNode(state, str(d.session_id), str(d.agent_name))
  if (!node) return
  if (typeof d.success === 'boolean') {
    node.status = d.success ? 'success' : 'failed'
    node.resultDigest = digestText(d.success ? d.answer : d.error) || node.resultDigest
  }
}

/** subagent 幂等查找：先按 session_id，再按 agent 名兜底（双事件字段覆盖度不同） */
function findSubagentNode(state: SessionBuildState, sessionId: string, agentName: string): SubagentNode | undefined {
  return (sessionId ? state.subagentNodes.get(sessionId) : undefined)
    || (agentName ? state.subagentNodes.get(`name:${agentName}`) : undefined)
}

/** 注册表键归一：节点补齐 session_id 后从 agent 名兜底键迁移到正式键，防双键双卡 */
function rekeySubagentNode(state: SessionBuildState, node: SubagentNode): void {
  if (node.agentName) state.subagentNodes.delete(`name:${node.agentName}`)
  const canonical = subagentKey(node.sessionId || '', node.agentName)
  if (canonical) state.subagentNodes.set(canonical, node)
}

/** subagent 注册键：优先子会话 ID，缺失时按 agent 名兜底 */
function subagentKey(sessionId: string, agentName: string): string {
  if (sessionId) return sessionId
  if (agentName) return `name:${agentName}`
  return ''
}

/** collect 节点：解析结果数组并按 sessionId 回填对应 subagent 卡片完成状态 */
function buildCollectNode(state: SessionBuildState, m: ChatMessage, end: any, offset: number): CollectNode | null {
  const parsed = parseResultJson(end.result)
  if (!Array.isArray(parsed) || !parsed.length) return null
  const sessionIds: string[] = []
  const resultDigests: string[] = []
  for (const entry of parsed) {
    const sid = str(entry?.session_id)
    if (!sid) continue
    const success = entry.status === 'completed'
    sessionIds.push(sid)
    resultDigests.push(digestText(success ? entry.result : entry.error))
    // 关联回填 subagent 卡片（实时路径：完成事件写入子会话流，主会话树靠 collect 收口）
    const node = state.subagentNodes.get(sid)
    if (node) {
      node.status = success ? 'success' : 'failed'
      node.resultDigest = digestText(success ? entry.result : entry.error)
    }
  }
  if (!sessionIds.length) return null
  return {
    id: `collect_${m.id}`,
    type: 'collect',
    sessionIds,
    resultDigests,
    status: m.eventData?.status === 'failed' ? 'failed' : 'success',
    startedAt: offset,
    durationMs: end.duration_ms > 0 ? end.duration_ms : undefined,
    foldDefault: true,
  }
}

// ── 节点构造：族 3 阻塞与系统 ─────────────────────────────────────────────

/** 参数摘要：取前 2 个有意义的键值拼一句话（名片展示，非结构化 dump） */
function digestParams(params: unknown): string {
  if (!params || typeof params !== 'object') return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(params as Record<string, any>)) {
    if (k.startsWith('_')) continue
    const val = typeof v === 'string' ? v : JSON.stringify(v)
    if (!val) continue
    parts.push(`${k}=${val.slice(0, 40)}`)
    if (parts.length >= 2) break
  }
  return tailText(parts.join(' · '), 80)
}

/** 未决授权审计闭环：同工具名的 pending 节点在决定到达时原位关闭 */
function closeOpenPermission(
  open: PermissionNode[],
  toolName: string,
  decision: 'granted' | 'denied',
  status: NodeStatus
): boolean {
  const idx = open.findIndex(p => p.decision === 'pending' && (!toolName || !p.toolName || p.toolName === toolName))
  if (idx < 0) return false
  const node = open[idx]!
  node.decision = decision
  node.status = status
  open.splice(idx, 1)
  return true
}

function buildPermissionPending(m: ChatMessage, offset: number): PermissionNode {
  const d = m.eventData || {}
  return reactive({
    id: `permission_${m.id}`,
    type: 'permission',
    toolName: str(d.tool_name ?? d.toolName),
    paramsDigest: digestParams(d.params ?? d.Params),
    decision: 'pending',
    reason: strOrUndef(d.reason ?? d.Reason),
    securityLevel: String(d.security_level ?? d.SecurityLevel ?? 'medium'),
    sessionId: strOrUndef(d.session_id),
    status: 'executing',
    startedAt: offset,
    foldDefault: true,
  } satisfies PermissionNode)
}

function buildPermissionDenied(m: ChatMessage, offset: number): PermissionNode {
  const d = typeof m.eventData === 'object' && m.eventData ? m.eventData : {}
  return {
    id: `permission_denied_${m.id}`,
    type: 'permission',
    toolName: str(d.tool_name ?? d.toolName),
    paramsDigest: digestParams(d.params),
    decision: 'denied',
    reason: strOrUndef(d.reason) || (typeof m.content === 'string' ? tailText(m.content, 120) : undefined),
    securityLevel: String(d.security_level ?? 'medium'),
    sessionId: strOrUndef(d.session_id),
    status: 'failed',
    startedAt: offset,
    foldDefault: true,
  }
}

function buildAskUserNode(m: ChatMessage, offset: number, pending: boolean): AskUserNode {
  const d = m.eventData || {}
  const questions: AskUserQuestion[] = (Array.isArray(d.questions) ? d.questions : []).map((q: any) => ({
    question: str(q?.question),
    options: Array.isArray(q?.options) ? q.options.map(String) : undefined,
    multiSelect: !!(q?.multi_select ?? q?.multiSelect),
  }))
  const answers = (Array.isArray(d.answers) ? d.answers : []).map((a: any) => ({
    question: str(a?.question),
    answer: str(a?.answer),
  }))
  return reactive({
    id: `ask_user_${m.id}`,
    type: 'ask_user',
    questions,
    answers,
    status: pending ? 'executing' : 'success',
    startedAt: offset,
    foldDefault: true,
  } satisfies AskUserNode)
}

function buildErrorNode(m: ChatMessage, offset: number): ErrorNode {
  const content = m.content || ''
  const code = str(m.eventData?.code)
  const httpClass = str(m.metadata?.http_class)
  // source 归一（归一规则 10）：402 欠费 / 超时路径 / 其余运行时错误
  const source: ErrorNode['source'] = httpClass === 'payment'
    ? 'provider_402'
    : (httpClass === 'timeout' || code === 'processing_timeout' || code === 'llm_timeout')
      ? 'llm_timeout'
      : 'runtime'
  const details = m.eventData && typeof m.eventData === 'object' && Object.keys(m.eventData).length > 0
    ? JSON.stringify(m.eventData, null, 2)
    : content
  return {
    id: `error_${m.id}`,
    type: 'error',
    message: tailText(content.split('\n')[0] || str(m.eventTitle), 200),
    source,
    httpClass: httpClass || undefined,
    details,
    status: 'failed',
    startedAt: offset,
    foldDefault: false,
  }
}

function buildCompactionNode(m: ChatMessage, offset: number): CompactionNode {
  const d = m.eventData || {}
  return {
    id: `compaction_${m.id}`,
    type: 'compaction',
    messagesSlid: num(d.messages_slid ?? d.MessagesSlid) ?? 0,
    remainingAfter: num(d.window_tokens ?? d.remaining_after) ?? 0,
    windowSize: num(d.max_window_size ?? d.window_size) ?? 0,
    status: 'success',
    startedAt: offset,
    foldDefault: true,
  }
}

function buildMaxTurnsNode(m: ChatMessage, offset: number): MaxTurnsNode {
  const d = m.eventData || {}
  return {
    id: `max_turns_${m.id}`,
    type: 'max_turns',
    turnsCompleted: num(d.turns_completed ?? d.TurnsCompleted) ?? 0,
    maxTurns: num(d.max_turns ?? d.MaxTurns) ?? 0,
    suggestion: strOrUndef(d.suggestion ?? d.Suggestion),
    status: 'success',
    startedAt: offset,
    foldDefault: true,
  }
}

function buildLlmRetryNode(m: ChatMessage, offset: number): LlmRetryNode {
  const d = m.eventData || {}
  const retryAfterNs = num(d.retry_after_ns ?? d.RetryAfterNs)
  return reactive({
    id: `llm_retry_${m.id}`,
    type: 'llm_retry',
    provider: str(d.provider ?? d.Provider),
    model: strOrUndef(d.model ?? d.Model),
    statusCode: num(d.status_code ?? d.StatusCode),
    attempt: num(d.attempt ?? d.Attempt) ?? 1,
    maxAttempts: num(d.max_attempts ?? d.MaxAttempts) ?? 3,
    retryAfterMs: retryAfterNs != null ? Math.round(retryAfterNs / 1e6) : undefined,
    error: strOrUndef(d.error ?? d.Error),
    status: 'success',
    startedAt: offset,
    foldDefault: true,
  } satisfies LlmRetryNode)
}

function buildCancelledNode(m: ChatMessage, offset: number): CancelledNode {
  const elapsedNs = num(m.eventData?.elapsed_ns ?? m.eventData?.ElapsedNs)
  return {
    id: `cancelled_${m.id}`,
    type: 'cancelled',
    by: 'user',
    elapsedMs: elapsedNs != null ? Math.round(elapsedNs / 1e6) : undefined,
    status: 'cancelled',
    startedAt: offset,
    foldDefault: false,
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : (v == null ? '' : String(v))
}

function strOrUndef(v: unknown): string | undefined {
  const s = str(v)
  return s || undefined
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function arrOfStr(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined
}

function pickDefined(params: Record<string, any>, keys: string[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (params[k] !== undefined && params[k] !== '') out[k] = params[k]
  }
  return Object.keys(out).length ? out : undefined
}

/** TeamDelete/TeamList/TeamGetTasks → 动作名（对照表三工具归一为一个节点类型） */
function teamAction(toolName: string): string {
  if (toolName === 'TeamDelete') return 'delete'
  if (toolName === 'TeamGetTasks') return 'get_tasks'
  return 'list'
}
