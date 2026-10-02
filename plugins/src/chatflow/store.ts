/**
 * ChatFlow store（四期：数据层重写件）。
 *
 * 源：mindx-desktop stores/chatStore.ts（消息流状态 + 事件归一）+ sessionStore.ts
 * 的会话恢复链路。desktop 双 store 拆分源于 Tab 模型与工作目录体系，work 单活动
 * 视图下合并为一个 store；Tab 模型 / token 统计面板 / 看门狗（实证 desktop 从未
 * 布防 armProcessingWatchdog，60s 空闲判定为死代码）不移植。
 *
 * 数据通道全部经 daemon.connection 服务（插件间禁止 import，契约 §10.2）：
 * - 命令（形态 A）：session.list / session.get / session.create / session.rename /
 *   session.truncate / session.delete_round / session.context / message.cancel，
 *   RPC 方法名与参数按移植计划附录 C 逐一对准，禁止猜测协议；
 * - 通知（形态 B）：发消息走 user.message notification（desktop client.sendMessage
 *   同帧），事件订阅 onNotification（envelope = {type, session_id, title, data, meta}，
 *   agent_name 在 meta.agent_name）。
 *
 * 事件归一要点（chatStore.ts L1301-2300 语义平移）：content_delta 经 120ms 节流
 * 微缓冲合并追加到尾随 markdown 消息；tool_use_delta 缓存参数待 start 合并；
 * tool_exec_end 按「最后一条 executing 工具消息」归位 status=done/failed；
 * loop_end 仅 termination_reason=completed 置 sessionLoopEnded（轮收拢判定）；
 * 阻塞事件（permission_request / form）插入前先落流式缓冲保证顺序；
 * 子会话事件写入子会话自己的消息流（单一数据源），sponsor 映射供授权魔术词路由。
 *
 * 调度任务 / token 统计全局面板（execution_summary / token_usage_recorded）与
 * 技能·员工热重载广播（agents_changed / skills_changed）不属对话流数据面，不订阅。
 */

import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import type { ChatMessage, ChatRound, SessionMessage } from './model/message'
import { classifyHttpError } from './model/message'
import { extFromMime, mimeFromPath } from './imageUtils'
import {
  loadPersistedSubtasks,
  persistSubtaskSpawn,
  persistSubtaskCompletion,
  type PersistedSubtask,
} from './model/subtask'
import type { Session } from './model/session'
import { clearTreeBuildState } from './tree/builder'
import type { ContextUsageInfo } from './tree/types/content'

// ── 服务契约（消费侧本地声明形状，插件间禁止 import）────────────────────────

const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  /** 连接状态（响应式值）：'connected' 后才允许发通知 */
  readonly state: string
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  /** JSON-RPC 通知发送（无 id 无响应）：user.message 通道。未连接返回 false */
  notify(method: string, params?: unknown): boolean
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

// ── 会话内数据契约 ────────────────────────────────────────────────────────

/** daemon 事件通知 envelope（params 原样；agent_name 在 meta.agent_name，附录 C.3） */
interface EventEnvelope {
  type?: string
  session_id?: string
  title?: string
  data?: any
  meta?: Record<string, unknown>
}

/** 待确认修改文件（FileReviewBar 数据面，localStorage 持久化；desktop chatStore 同构） */
export interface PendingFileMod {
  path: string
  diff: string
  additions: number
  deletions: number
  isNew: boolean
}

const PENDING_FILES_KEY = 'mindx.pendingFileModificationsBySession'

function loadPendingFilesMap(): Record<string, PendingFileMod[]> {
  try {
    const raw = localStorage.getItem(PENDING_FILES_KEY)
    // 形状校验（§17 持久化读回边界）：解析结果必须是「键 → 数组」的普通对象，
    // 存储被外力污染（null/标量/值非数组）时逐条剔除或整体降级空表
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: Record<string, PendingFileMod[]> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) map[key] = value
    }
    return map
  } catch {
    return {}
  }
}

function persistPendingFilesMap(map: Record<string, PendingFileMod[]>): void {
  try {
    localStorage.setItem(PENDING_FILES_KEY, JSON.stringify(map))
  } catch {
    // 存储不可用时降级为会话内保留
  }
}

/** session.get 返回（附录 C.3：{session_id, messages, meta, modify_files}） */
interface SessionDetailResp {
  session_id: string
  messages?: SessionMessage[]
  meta?: Record<string, unknown>
  modify_files?: PendingFileMod[]
}

/** session.list 条目（ServerSessionInfo；无 message_count 字段——前端不维护计数） */
interface ServerSessionInfo {
  session_id: string
  agent_name?: string
  title?: string
  project_dir?: string
  session_dir?: string
  last_activity_at: string
  created_at: string
}

/** daemon 模型配置（model.list 条目；desktop ModelInfo 同构，展示面只取子集） */
export interface ModelInfo {
  name: string
  title?: string
  description?: string
  provider: string
  enabled?: boolean
  context_length?: number
  is_local?: boolean
}

/** daemon 供应商配置（provider.list 条目；api_key 为 boolean——是否已配密钥） */
export interface ProviderInfo {
  name: string
  title?: string
  api_key?: boolean
  base_url?: string
}

// ── 轮次分组（纯派生，desktop buildChatRounds 的 work 形状投影）────────────

/** 是否为本轮「最终答案」信号（精确收尾判定，desktop isFinalAnswerMessage 同构）：
 *  1. task_summary / final_answer 消息（实时收尾事件）
 *  2. finish_reason === 'stop'（OpenAI 协议原值，恢复历史时由 session.get 透传）
 *  3. 旧数据回退：无 eventType 的 assistant 消息 */
function isFinalAnswerSignal(m: ChatMessage): boolean {
  const et = m.eventType
  if (et === 'task_summary' || et === 'final_answer') return true
  if (m.metadata?.finish_reason === 'stop') return true
  if (!et && m.role === 'assistant') return true
  return false
}

/** 将扁平消息数组按 user 消息边界分组成轮次（纯派生，不修改存储） */
export function buildRounds(messages: ChatMessage[]): ChatRound[] {
  const rounds: ChatRound[] = []
  let current: ChatRound | null = null
  for (const m of messages) {
    if (m.role === 'user') {
      current = { key: m.id, userMessage: m, messages: [m], hasFinalAnswer: false }
      rounds.push(current)
      continue
    }
    if (!current) {
      // 消息流开头未出现 user 消息（历史异常数据）：归入前导轮，保证全量渲染
      current = { key: 'prelude_' + m.id, userMessage: null, messages: [], hasFinalAnswer: false }
      rounds.push(current)
    }
    current.messages.push(m)
    if (isFinalAnswerSignal(m)) current.hasFinalAnswer = true
  }
  return rounds
}

// ── store ─────────────────────────────────────────────────────────────────

export const useChatflowStore = defineStore('chatflow-store', () => {
  // 服务本体在 store 初始化时捕获（首次 useChatflowStore 由组件 setup 触发，inject 有效）
  const daemon = useService<DaemonConnection>(DAEMON_CONNECTION)
  // 壳本体同步捕获（同上时机；供 action 内按需 services.use 消费详情轨道四插件）
  const shell = useShell()

  // ---------- 会话列表（Tasks 数据源）----------
  /** 全量会话列表（session.list 无参，daemon 按 LastActivityAt 倒序返回；Tasks 按目录名分组） */
  const sessions = ref<Session[]>([])
  const sessionsLoading = ref(false)
  const sessionsLoaded = ref(false)
  /** 当前 Agent（新会话归属；AgentSwitcher 切换） */
  const currentAgent = ref('')
  /** 当前工作目录（新会话落点；点击会话行即「打开该目录」，desktop currentProjectDir 同语义） */
  const currentProjectDir = ref('')

  // ---------- 活动会话与消息流 ----------
  const activeSessionId = ref('')
  const messagesBySession = reactive<Record<string, ChatMessage[]>>({})
  /** 已加载消息流的会话（switchToSession 复用内存缓存判定） */
  const loadedSessions = reactive(new Set<string>())

  // ---------- 处理状态 ----------
  const busySessions = reactive<Record<string, boolean>>({})
  const isProcessing = ref(false)
  /** 最新消息已进入会话串行队列等待执行（message_queued / message_processing 驱动） */
  const isQueued = ref(false)
  const isRestoringSession = ref(false)
  /** 消息已加载完毕待揭晓（宿主页先滚动底部再移除骨架屏） */
  const sessionRevealPending = ref(false)
  const isCompacting = ref(false)
  const lastError = ref<string | null>(null)
  /** daemon 连接可用（desktop connectionStore.isConnected 同语义；state 为响应式 getter 穿透） */
  const isConnected = computed(() => daemon.state === 'connected')

  /** 会话级「本轮已结束」标记：loop_end(termination_reason=completed) 置 true，
   *  发送新消息时重置——配合 finish_reason=stop 驱动轮收拢（RoundInput.isFinal） */
  const sessionLoopEnded = reactive<Record<string, boolean>>({})

  // ---------- 跨端运行态对齐（session.statuses 轮询） ----------
  // 事件按发起客户端单播：其它端（TUI 等）跑起来的执行，本端收不到在途事件，
  // 侧栏运行指示（头像呼吸）与 ChatInput 停止态只能靠轮询 daemon 拉取对齐。

  /** 上一轮 daemon 报告的运行中会话：仅对「报告过又消失」的会话熄灭，
   *  本端本地自置的 busy（sendMessage 在途窗口）不被轮询误清 */
  const lastRunningReport = new Set<string>()

  /** 拉取 daemon 运行中会话清单并对齐 busySessions（主会话队列 + 子代理登记） */
  async function refreshRunningSessions(): Promise<void> {
    try {
      const list = await daemon.call<{ session_id: string; kind: string }[]>('session.statuses', {})
      const running = new Set((list || []).map((s) => s.session_id))
      for (const sid of running) busySessions[sid] = true
      for (const sid of lastRunningReport) {
        if (!running.has(sid) && busySessions[sid]) delete busySessions[sid]
      }
      lastRunningReport.clear()
      for (const sid of running) lastRunningReport.add(sid)
    } catch {
      // 旧版 daemon 无此方法 / 连接断开：静默跳过，等下一轮轮询
    }
  }

  // 连接建立即对齐一次并启动 5s 周期轮询；断开停止（重连后 immediate 再对齐）
  let runningPollTimer: ReturnType<typeof setInterval> | null = null
  watch(
    isConnected,
    (connected) => {
      if (connected) {
        void refreshRunningSessions()
        if (!runningPollTimer) {
          runningPollTimer = setInterval(() => void refreshRunningSessions(), 5000)
        }
      } else if (runningPollTimer) {
        clearInterval(runningPollTimer)
        runningPollTimer = null
      }
    },
    { immediate: true },
  )

  // ---------- 未读标记（Tasks 行四要素之一）----------
  /** 后台会话终态事件计数（轮完成 / 错误 / 轮数上限）；打开会话即清零。
   *  仅按「非活动会话」计数：活动会话用户正在看，不产生未读 */
  const unreadBySession = reactive<Record<string, number>>({})

  /** 后台会话置未读（终态事件钩子共用） */
  function markUnread(sessionId: string): void {
    if (!sessionId || sessionId === activeSessionId.value) return
    unreadBySession[sessionId] = (unreadBySession[sessionId] || 0) + 1
  }

  // ---------- 阻塞交互 / 上下文 / 文件审查 ----------
  /** 非阻塞权限：最近一次授权请求的 tool_name（魔术词兜底） */
  const pendingPermissionToolName = ref('')
  const contextUsage = ref<ContextUsageInfo | null>(null)
  const pendingFileModificationsBySession = reactive<Record<string, PendingFileMod[]>>(loadPendingFilesMap())

  // ---------- 事件归一内部缓冲（不进渲染面，普通对象即可） ----------
  /** content_delta 微缓冲（120ms 节流合并用） */
  const pendingContentBySession: Record<string, string> = {}
  /** 每会话节流定时器句柄 */
  const streamFlushTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  /** thinking 增量按会话累积（thinking_done 时落正文） */
  const thinkingContentBySession: Record<string, string> = {}
  /** 最近发送的 user 消息本地 id（user_message_saved 事件精确回填 backendTimestamp） */
  const pendingBackendTsUserBySession: Record<string, string> = {}
  /** 子会话 → 发起它的主会话（sponsor）：授权/提问魔术词必须发往主会话路由（附录 C.3） */
  const subSessionSponsor: Record<string, string> = {}
  /** 各会话当前正在产生事件的 agent（消息来源标记） */
  const sessionCurrentAgentName: Record<string, string> = {}
  /** goharness 发送顺序 tool_use_delta → tool_exec_start → tool_exec_end：
   *  start 到达前暂存 delta（不做协议转换） */
  let pendingToolUseDelta: { index: number; id: string; name: string; arguments: string } | null = null

  // ---------- 派生：活动会话 / 轮次 / builder 输入 ----------

  const activeSession = computed<Session | null>(
    () => sessions.value.find((s) => s.session_id === activeSessionId.value) || null,
  )

  const activeMessages = computed<ChatMessage[]>(() => messagesBySession[activeSessionId.value] || [])

  /** 活动会话轮次（user 消息边界分组） */
  const rounds = computed<ChatRound[]>(() => buildRounds(activeMessages.value))

  /**
   * builder 轮输入：isFinal 口径与 desktop ChatArea 一致——loop 结束 / 本轮已有
   * 最终答案 / 非末轮（后续已有新轮开启）。非末轮必已终结——典型如 AskUser 阻塞轮：
   * 用户回答开启新轮后，旧轮的 form 节点若仍按 executing 渲染会永久显示
   * 「等待你的回答」流光动画。
   */
  const roundInputs = computed(() => {
    const sid = activeSessionId.value
    const ended = !!sessionLoopEnded[sid]
    const rs = rounds.value
    return rs.map((r, i) => ({
      key: r.key,
      messages: r.messages,
      isFinal: ended || r.hasFinalAnswer || i < rs.length - 1,
    }))
  })

  /**
   * 子会话消息流（builder opts.subagentStreams 数据源）：
   * 主会话流 subtask_spawned 卡片 ∪ localStorage 子任务登记，逐个取已加载的子会话流
   * （与 desktop prefetchSubagentStreams 的子会话集合推导同构）。
   */
  const subagentStreams = computed<Record<string, ChatMessage[]>>(() => {
    const sid = activeSessionId.value
    if (!sid) return {}
    const subIds = new Set<string>()
    for (const m of messagesBySession[sid] || []) {
      if (m.eventType === 'subtask_spawned' && m.eventData?.session_id) {
        subIds.add(String(m.eventData.session_id))
      }
    }
    for (const entry of loadPersistedSubtasks(sid)) {
      if (entry.session_id) subIds.add(entry.session_id)
    }
    const streams: Record<string, ChatMessage[]> = {}
    for (const subId of subIds) {
      const stream = messagesBySession[subId]
      if (stream && stream.length > 0) streams[subId] = stream
    }
    return streams
  })

  /** builder 其余 opts：localStorage 子任务登记（恢复三路合成旁路数据源） */
  function persistedSubtasksFor(sessionId: string): PersistedSubtask[] {
    return loadPersistedSubtasks(sessionId)
  }

  function isBusy(sessionId?: string): boolean {
    if (!sessionId) return isProcessing.value
    return !!busySessions[sessionId]
  }

  // ---------- 消息写入原语 ----------

  function addMessage(sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp' | 'sessionId'>): ChatMessage {
    if (!messagesBySession[sessionId]) messagesBySession[sessionId] = []
    const newMessage: ChatMessage = {
      ...message,
      agentName: message.agentName || sessionCurrentAgentName[sessionId],
      id: `${message.role}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      sessionId,
    }
    messagesBySession[sessionId].push(newMessage)
    return newMessage
  }

  /** 首条 user 消息本地即时补题（daemon 侧自动补录在下次列表刷新时回填） */
  function addUserMessage(
    sessionId: string,
    text: string,
    images?: Array<{ path?: string; media_type?: string; base64_data?: string }>,
  ): ChatMessage {
    const messages = messagesBySession[sessionId] || []
    if (!messages.some((m) => m.role === 'user')) {
      const truncated = text.replace(/\n/g, ' ').trim().substring(0, 40)
      const target = sessions.value.find((s) => s.session_id === sessionId)
      if (target) target.title = truncated.length < text.length ? truncated + '...' : truncated
    }
    return addMessage(sessionId, {
      role: 'user',
      content: text,
      ...(images && images.length > 0 ? { images } : {}),
    })
  }

  /**
   * 回填最后一条 user 消息的 metadata.backendTimestamp（user_message_saved 事件）。
   * 优先精确匹配「刚发送」的消息（防连续发送时事件乱序错位），登记一次即失效；
   * 兜底倒序找最后一条尚未回填的 user 消息。使「回收本轮」按钮刷新前即可用。
   */
  function patchLastUserMessageTimestamp(sessionId: string, timestamp: number): void {
    if (!sessionId || !timestamp) return
    const messages = messagesBySession[sessionId]
    if (!messages) return

    const pendingId = pendingBackendTsUserBySession[sessionId]
    if (pendingId) {
      const pendingMsg = messages.find((m) => m.id === pendingId)
      if (pendingMsg && !pendingMsg.metadata?.backendTimestamp) {
        pendingMsg.metadata = { ...pendingMsg.metadata, backendTimestamp: timestamp }
      }
      delete pendingBackendTsUserBySession[sessionId]
      return
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!msg) continue
      if (msg.role === 'user') {
        if (!msg.metadata?.backendTimestamp) {
          msg.metadata = { ...msg.metadata, backendTimestamp: timestamp }
        }
        return
      }
    }
  }

  // ---------- 会话列表 ----------

  /** 全量会话列表（无参 = 跨 Agent 全量；Tasks 分组数据源；daemon 按 LastActivityAt 倒序） */
  async function loadSessions(): Promise<void> {
    sessionsLoading.value = true
    try {
      const list = await daemon.call<ServerSessionInfo[]>('session.list', {})
      const mapped = (list || []).map((s) => ({
        session_id: s.session_id,
        agent_name: s.agent_name || '',
        title: s.title || '',
        created_at: s.created_at,
        updated_at: s.last_activity_at,
        message_count: 0,
        project_dir: s.project_dir,
        session_dir: s.session_dir,
      }))
      // 同 id 去重（daemon 分片存储按 agent 目录归档，同一会话可能存在跨 agent
      // 重复副本，如 assistant 下无目录副本 + architect 下正常副本）：project_dir
      // 非空优先，其次最近活跃。空目录副本若赢得去重，会话恢复后 currentProjectDir
      // 不就位——explorer 详情轨道永远停在「正在定位工作目录」，发送链路同样卡死
      const byId = new Map<string, Session>()
      for (const s of mapped) {
        const prev = byId.get(s.session_id)
        if (!prev) {
          byId.set(s.session_id, s)
          continue
        }
        const better =
          (!!s.project_dir && !prev.project_dir) ||
          (!!s.project_dir === !!prev.project_dir && s.updated_at > prev.updated_at)
        if (better) byId.set(s.session_id, s)
      }
      // Map 保序（插入序 = daemon 返回的活跃度倒序），去重不改排序
      sessions.value = [...byId.values()]
      sessionsLoaded.value = true
      // 启动自动激活：列表就绪后自动打开最近会话（用户定稿：一进入就加载会话，
      // 工作目录/Agent 随 switchToSession 就位，发送链路立即可用）。仅缺活动会话
      // 时触发，不抢占已打开会话，也不影响手动「新会话」的 hero 态。
      if (!activeSessionId.value && sessions.value.length > 0) {
        // 无工作目录的会话不可用（发送链路必卡「请先选择工作区」，explorer 详情轨道无根
        // 永远停在「正在定位工作目录」）：自动激活只在有目录的会话里选最近；
        // 全部无目录则保持 hero 态，等用户经工作区选择 chip 显式就位
        let latest: Session | null = null
        for (const s of sessions.value) {
          if (!s.project_dir) continue
          if (!latest || s.updated_at > latest.updated_at) latest = s
        }
        if (latest) void switchToSession(latest.session_id)
      }
    } catch (err) {
      // 拉取失败仅记日志不逃逸（desktop syncAgentSessions 同语义），允许后续重试
      console.warn('[ChatFlow] 会话列表加载失败:', err)
    } finally {
      sessionsLoading.value = false
    }
  }

  /** 服务端会话信息 upsert 进本地列表（latest_by_dir / 子会话等入口共用） */
  function upsertSessionFromServer(info: ServerSessionInfo): void {
    const mapped: Session = {
      session_id: info.session_id,
      agent_name: info.agent_name || '',
      title: info.title || '',
      created_at: info.created_at,
      updated_at: info.last_activity_at,
      message_count: 0,
      project_dir: info.project_dir,
      session_dir: info.session_dir,
    }
    const idx = sessions.value.findIndex((s) => s.session_id === mapped.session_id)
    if (idx >= 0) sessions.value[idx] = { ...sessions.value[idx], ...mapped }
    else sessions.value.unshift(mapped)
  }

  // ---------- 会话切换与历史恢复 ----------

  /** 卸载会话内存流并清空树构建状态（压缩滑动窗口失效 / 换会话防串话用） */
  function unloadSession(sessionId: string): void {
    loadedSessions.delete(sessionId)
    delete messagesBySession[sessionId]
    // 流式缓冲一并清空：残留的 120ms 节流 timer 到点会经 addMessage 复活已删数组，
    // 产生只含孤立文本的幽灵流（子会话场景会阻塞真实历史预取）
    delete pendingContentBySession[sessionId]
    const timer = streamFlushTimers[sessionId]
    if (timer) {
      clearTimeout(timer)
      delete streamFlushTimers[sessionId]
    }
    delete thinkingContentBySession[sessionId]
    clearTreeBuildState(sessionId)
  }

  /**
   * 标记会话已加载（desktop sessionStore.markSessionLoaded 同构）：跳转阻塞子会话时，
   * 子会话流已有实时数据（messagesBySession 实时 push），先登记避免 switchToSession
   * 拉服务端旧快照覆盖实时流。
   */
  function markSessionLoaded(sessionId: string): void {
    if (sessionId) loadedSessions.add(sessionId)
  }

  /**
   * 切换会话：骨架屏 → session.get 恢复 → 揭晓标记（宿主页滚动到底后移除骨架）。
   * 已加载会话复用内存缓存，仅异步重同步待确认文件列表（本地 diff 是历史快照，
   * 以服务器 modify_files 为准）；agent 与工作目录随目标会话自动切换。
   */
  async function switchToSession(sessionId: string): Promise<void> {
    isRestoringSession.value = true
    // 显式归零：若上次揭晓失败卡在 true，本次 restore 置 true 值不变会导致
    // 宿主页揭晓 watch 不触发（骨架屏永久覆盖）。每次切换归零保证必触发。
    sessionRevealPending.value = false
    activeSessionId.value = sessionId
    // 打开即已读
    delete unreadBySession[sessionId]

    const session = sessions.value.find((s) => s.session_id === sessionId)
    if (session?.agent_name) {
      currentAgent.value = session.agent_name
      // 历史恢复无实时事件登记：以会话归属 Agent 回填执行 Agent 表，
      // 驱动轮头「Agent 行」显示真实头像与昵称（否则回退 'A Agent' 兜底）
      sessionCurrentAgentName[sessionId] = session.agent_name
    }
    if (session?.project_dir) currentProjectDir.value = session.project_dir

    // 重置上下文用量并拉取新会话的窗口用量（避免残留上一会话数据）
    contextUsage.value = null
    void fetchContextUsage(sessionId)

    if (loadedSessions.has(sessionId)) {
      isRestoringSession.value = false
      void daemon
        .call<SessionDetailResp>('session.get', { session_id: sessionId })
        .then((detail) => setPendingFilesFromServer(sessionId, detail?.modify_files))
        .catch(() => {
          // 拉取失败保持现状（本地列表仍在，下次切换再同步）
        })
      return
    }

    try {
      const detail = await daemon.call<SessionDetailResp>('session.get', { session_id: sessionId })
      loadedSessions.add(sessionId)
      // 重载后后端不会再发 file_modified 事件：用 session.get 附带的 modify_files 恢复列表
      setPendingFilesFromServer(sessionId, detail?.modify_files)
      if (detail?.messages && detail.messages.length > 0) {
        restoreSessionMessages(sessionId, detail.messages)
        sessionRevealPending.value = true
        // 子代理嵌套流预取（fire-and-forget，不阻塞会话恢复）
        void prefetchSubagentStreams(sessionId)
      } else {
        if (!messagesBySession[sessionId]) messagesBySession[sessionId] = []
        isRestoringSession.value = false
      }
    } catch (err) {
      console.warn('[ChatFlow] 会话历史加载失败:', sessionId, err)
      lastError.value = err instanceof Error ? err.message : String(err)
      isRestoringSession.value = false
    }
  }

  /** 清空对话流（目录下无会话 / 显式切换无命中）：保留目录与 Agent，不自动新建 */
  function clearActiveStream(): void {
    activeSessionId.value = ''
    isProcessing.value = false
    isQueued.value = false
    isRestoringSession.value = false
  }

  /**
   * 子会话历史预取（恢复态内联直播）：主会话恢复完成后对每个子任务会话拉取
   * session.get，经 restoreSessionMessages 同构转换写入子会话流——树构建器从
   * subagentStreams 归一化出嵌套 children。拉取失败静默降级。
   */
  async function prefetchSubagentStreams(sponsorSessionId: string): Promise<void> {
    const messages = messagesBySession[sponsorSessionId]
    if (!messages || messages.length === 0) return
    const subIds = new Set<string>()
    for (const m of messages) {
      if (m.eventType === 'subtask_spawned' && m.eventData?.session_id) {
        subIds.add(String(m.eventData.session_id))
      }
    }
    // localStorage 登记的子会话一并预取：spawn 消息可能已滑出压缩窗口
    for (const entry of loadPersistedSubtasks(sponsorSessionId)) {
      if (entry.session_id) subIds.add(entry.session_id)
    }
    if (subIds.size === 0) return
    for (const subId of subIds) {
      // 已有实时流/已加载内容的不覆盖（单一数据源不回退）
      if ((messagesBySession[subId] || []).length > 0) continue
      try {
        const detail = await daemon.call<SessionDetailResp>('session.get', { session_id: subId })
        const serverMessages = detail?.messages || []
        if (serverMessages.length > 0) {
          restoreSessionMessages(subId, serverMessages)
          loadedSessions.add(subId)
        }
      } catch (err) {
        console.warn('[ChatFlow] 子会话历史预取失败（内联回看降级）:', subId, err)
      }
    }
  }

  // ---------- 历史快照恢复（desktop restoreSessionMessages L553-1058 语义平移） ----------

  /**
   * serverMessages → ChatMessage[] 归一：
   * - 带 tool_calls 的 assistant 不直接进列表（只贡献 thinking_done / 过程 content），
   *   其 token_usage 累加 pendingUsage 并入本轮最终回复消息（否则调用量被低估）；
   * - role=tool 结果按 tool_call_id 归位为 tool_exec 消息（SubAgent / AskUser 特判）；
   * - CollectResults 结果由预扫描收集，回填到 spawned 卡片（恢复视图与实时一致，
   *   同一子任务不裂成多个视觉块）；
   * - 子会话内部标记消息（[sub-agent-task-start] / [sub-agent-terminated]）跳过；
   * - 被压缩窗口清掉的子任务卡片从 localStorage 登记补齐（恢复三路合成）。
   */
  function restoreSessionMessages(sessionId: string, serverMessages: SessionMessage[]): void {
    if (!serverMessages || serverMessages.length === 0) return

    const restored: ChatMessage[] = []
    // 按 tool_call_id 索引待匹配的工具调用（一个 assistant 可并发调用多个工具）
    const pendingToolCalls = new Map<string, { name: string; args: any }>()
    const toolCallStartTimestamps = new Map<string, number>()
    let prevTimestamp = 0

    // 累加器：中间 assistant 调用的 usage 并入本轮最终回复消息
    let pendingUsage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      cached_tokens: number
      reasoning_tokens: number
      cost: number
      call_count: number
    } | null = null
    let lastToolRoundUsage: SessionMessage['token_usage'] | null = null

    // 预扫描：收集全部 CollectResults 结果（子会话 ID → 完成状态），恢复 spawned 卡片时回填
    const collectResultsMap: Record<string, { success: boolean; answer: string; error: string }> = {}
    const restoredSpawnedIDs = new Set<string>()
    {
      const toolCallNameMap = new Map<string, string>()
      for (const msg of serverMessages) {
        if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            if (tc?.id && tc?.name) toolCallNameMap.set(tc.id, tc.name)
          }
        }
      }
      for (const msg of serverMessages) {
        if (msg.role !== 'tool' || !msg.tool_call_id) continue
        if (toolCallNameMap.get(msg.tool_call_id) !== 'CollectResults') continue
        const content = typeof msg.content === 'string' ? msg.content : ''
        try {
          const parsed = JSON.parse(content)
          if (Array.isArray(parsed)) {
            for (const entry of parsed) {
              if (entry?.session_id) {
                collectResultsMap[entry.session_id] = {
                  success: entry.status === 'completed',
                  answer: entry.status === 'completed' ? entry.result || '' : '',
                  error: entry.status === 'completed' ? '' : entry.error || '',
                }
              }
            }
          }
        } catch {
          // 旧文本格式不再回填（历史遗留会话维持普通工具行展示）
        }
      }
    }

    // 子会话任务边界标记（[sub-agent-task-start]）及其后的任务描述消息是 spawn 静默写入
    // 的内部消息（实时视图不可见），恢复时统一跳过；紧邻标记的 user 消息即任务描述，
    // 中间夹入其他消息即复位不误伤用户真实输入
    let skipTaskDescription = false

    for (let idx = 0; idx < serverMessages.length; idx++) {
      const msg = serverMessages[idx]
      if (!msg) continue
      const msgTimestamp = typeof msg.timestamp === 'number' ? msg.timestamp : 0

      if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.startsWith('[sub-agent-task-start]')) {
        skipTaskDescription = true
        continue
      }
      if (skipTaskDescription) {
        skipTaskDescription = false
        if (msg.role === 'user') continue
      }

      // 子代理终止标记（spawn 写入的内部 assistant 消息）：恢复时跳过，
      // 终止状态由主会话 SubAgent 卡片的失败态呈现
      if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.startsWith('[sub-agent-terminated]')) {
        continue
      }

      // 先收集所有 tool_calls（一个 assistant 可能并发调用多个工具）
      const toolCalls = msg.tool_calls
      if (msg.role === 'assistant' && toolCalls && toolCalls.length > 0) {
        // 同一消息可能同时有 reasoning_content 和 tool_calls，先恢复思想流
        if (msg.reasoning_content && msg.reasoning_content.trim()) {
          const thinkDurationMs = prevTimestamp > 0 ? Math.round((msgTimestamp - prevTimestamp) * 1000) : 0
          restored.push({
            id: `restored_thinking_${idx}_${msg.timestamp}`,
            role: 'assistant',
            content: msg.reasoning_content,
            eventType: 'thinking_done',
            eventTitle: '思考中',
            metadata: { complete: true, duration_ms: thinkDurationMs },
            timestamp: new Date(msg.timestamp).toISOString(),
            sessionId,
          })
        }
        // 带 tool_calls 的 assistant 不进消息列表，token_usage 累加待合并
        if (msg.token_usage) {
          const u = msg.token_usage
          lastToolRoundUsage = u
          if (!pendingUsage) {
            pendingUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, cost: 0, call_count: 0 }
          }
          pendingUsage.prompt_tokens += u.prompt_tokens || 0
          pendingUsage.completion_tokens += u.completion_tokens || 0
          pendingUsage.total_tokens += u.total_tokens || 0
          pendingUsage.cached_tokens += u.cached_tokens || 0
          pendingUsage.reasoning_tokens += u.reasoning_tokens || 0
          pendingUsage.cost += msg.cost || 0
          pendingUsage.call_count += 1
        }
        for (const tc of toolCalls) {
          pendingToolCalls.set(tc.id, {
            name: tc.name || '工具调用',
            args: tc.arguments
              ? (() => {
                  try {
                    return JSON.parse(tc.arguments)
                  } catch {
                    return tc.arguments
                  }
                })()
              : null,
          })
          toolCallStartTimestamps.set(tc.id, msgTimestamp)
        }
        prevTimestamp = msgTimestamp
        continue
      }

      // role=tool 结果消息按 tool_call_id 精确归位
      if (msg.role === 'tool') {
        const match = pendingToolCalls.get(msg.tool_call_id || '')
        const toolName = match?.name || 'tool'
        const toolArgs = match?.args || null
        const startTs = toolCallStartTimestamps.get(msg.tool_call_id || '')
        const durationMs = startTs ? Math.round((msgTimestamp - startTs) * 1000) : 0
        const content = msg.content || ''

        if (toolName === 'SubAgent') {
          // SubAgent 工具结果 JSON：{"status":"running","agent_name":"...","session_id":"..."}
          let agentName = ''
          let sessionID = ''
          try {
            const parsed = JSON.parse(content)
            agentName = parsed.agent_name || ''
            sessionID = parsed.session_id || ''
          } catch {
            // 非 JSON 内容维持空字段
          }
          // 有 CollectResults 结果的子任务直接渲染完成态卡片；无结果保持执行中观察窗
          const collectResult = sessionID ? collectResultsMap[sessionID] : undefined
          if (sessionID) restoredSpawnedIDs.add(sessionID)
          restored.push({
            id: `restored_tool_${idx}_${msg.timestamp}`,
            role: 'system',
            content,
            eventType: 'subtask_spawned',
            eventTitle: '子任务',
            // 任务描述从 SubAgent 调用参数 arguments.task 恢复（不持久化在 tool 结果里）
            eventData: {
              session_id: sessionID,
              agent_name: agentName,
              description: toolArgs?.task || '',
              success: collectResult?.success,
              answer: collectResult?.answer || '',
              error: collectResult?.error || '',
            },
            metadata: { phase: 'subtask_spawned' },
            timestamp: new Date(msg.timestamp).toISOString(),
            sessionId,
          })
        } else if (toolName === 'CollectResults') {
          // 结果已由预扫描回填到 spawned 卡片；执行记录仍恢复为 tool_exec（保留调用轨迹）
          restored.push({
            id: `restored_tool_${idx}_${msg.timestamp}`,
            role: 'tool',
            content,
            eventType: 'tool_exec',
            eventTitle: toolName,
            eventData: {
              start: { tool_name: toolName, params: toolArgs },
              end: {
                tool_name: toolName,
                success: true,
                result: content,
                duration_ms: durationMs,
                prompt_tokens: lastToolRoundUsage?.prompt_tokens || 0,
                completion_tokens: lastToolRoundUsage?.completion_tokens || 0,
                total_tokens: lastToolRoundUsage?.total_tokens || 0,
                cached_tokens: lastToolRoundUsage?.cached_tokens || 0,
              },
              status: 'done',
            },
            metadata: { phase: 'complete', success: true, tool_call_id: msg.tool_call_id },
            timestamp: new Date(msg.timestamp).toISOString(),
            sessionId,
          })
        } else if (toolName === 'AskUser') {
          // AskUser 从调用参数重建 form 事件（问题表单）
          const formData: Record<string, any> = {}
          if (toolArgs) {
            formData.correlation_id = `restored_${msg.timestamp}`
            const questions: any[] = []
            if (toolArgs.question) {
              questions.push({
                question: toolArgs.question,
                options: Array.isArray(toolArgs.options) ? toolArgs.options : [],
                multi_select: !!toolArgs.multiSelect,
              })
            }
            if (questions.length > 0) formData.questions = questions
          }
          restored.push({
            id: `restored_form_${idx}_${msg.timestamp}`,
            role: 'system',
            content: '',
            eventType: 'form',
            eventTitle: '需要澄清',
            eventData: formData,
            metadata: { phase: 'clarify' },
            timestamp: new Date(msg.timestamp).toISOString(),
            sessionId,
          })
        } else {
          restored.push({
            id: `restored_tool_${idx}_${msg.timestamp}`,
            role: 'tool',
            content,
            eventType: 'tool_exec',
            eventTitle: toolName,
            eventData: {
              start: { tool_name: toolName, params: toolArgs },
              end: {
                tool_name: toolName,
                success: true,
                result: content,
                duration_ms: durationMs,
                prompt_tokens: lastToolRoundUsage?.prompt_tokens || 0,
                completion_tokens: lastToolRoundUsage?.completion_tokens || 0,
                total_tokens: lastToolRoundUsage?.total_tokens || 0,
                cached_tokens: lastToolRoundUsage?.cached_tokens || 0,
              },
              status: 'done',
            },
            metadata: { phase: 'complete', success: true, tool_call_id: msg.tool_call_id },
            timestamp: new Date(msg.timestamp).toISOString(),
            sessionId,
          })
        }
        pendingToolCalls.delete(msg.tool_call_id || '')
        prevTimestamp = msgTimestamp
        continue
      }

      let role: ChatMessage['role'] = 'system'
      let eventType: string | undefined
      let eventTitle = ''
      let eventData: any | undefined
      // 过程迭代（带 tool_calls 的 assistant 正文）已单独恢复为推理区消息，
      // 置位后跳过末尾的通用 push，避免重复产生「伪最终答案」
      let skipRestorePush = false

      switch (msg.role) {
        case 'user':
          role = 'user'
          break
        case 'assistant': {
          // 先恢复思想流（reasoning_content 是 assistant 消息内嵌字段，非独立 role）
          if (msg.reasoning_content && msg.reasoning_content.trim()) {
            const thinkDurationMs = prevTimestamp > 0 ? Math.round((msgTimestamp - prevTimestamp) * 1000) : 0
            restored.push({
              id: `restored_thinking_${idx}_${msg.timestamp}`,
              role: 'assistant',
              content: msg.reasoning_content,
              eventType: 'thinking_done',
              eventTitle: '思考中',
              metadata: { complete: true, duration_ms: thinkDurationMs },
              timestamp: new Date(msg.timestamp).toISOString(),
              sessionId,
            })
          }
          // 带 tool_calls 的 assistant 正文是过程内容：恢复为 markdown 并标记 is_reasoning
          //（buildRounds/builder 归入推理区），无 tool_calls 的才是最终答案
          const hasToolCalls = (msg.tool_calls?.length || 0) > 0
          if (msg.content && hasToolCalls) {
            restored.push({
              id: `restored_content_${idx}_${msg.timestamp}`,
              role: 'assistant',
              content: msg.content,
              eventType: 'markdown',
              eventTitle: '',
              metadata: { is_reasoning: true, finish_reason: msg.finish_reason || '' },
              timestamp: new Date(msg.timestamp).toISOString(),
              sessionId,
            })
            skipRestorePush = true
          }
          role = 'assistant'
          break
        }
        default:
          role = 'system'
          // 旧格式 subtask 历史（markdown 文本）兼容还原
          if (msg.content) {
            const c = msg.content
            const subtaskMatch = c.match(/^### .+: `([^`]+)`/m)
            if (subtaskMatch) {
              const extractField = (pattern: RegExp) => {
                const m = c.match(pattern)
                return m && m[1] ? m[1].trim() : ''
              }
              if (c.indexOf('**Agent**:') >= 0) {
                eventType = 'subtask_spawned'
                eventData = {
                  session_id: '',
                  agent_name: extractField(/\*\*Agent\*\*: (.+)/),
                  description: extractField(/\*\*(?:描述|Description)\*\*: (.+)/m),
                }
                eventTitle = '子任务'
              } else if (c.indexOf('**结果**:') >= 0 || c.indexOf('**Answer**:') >= 0) {
                eventType = 'subtask_completed'
                eventData = {
                  session_id: '',
                  agent_name: extractField(/\*\*Agent\*\*: (.+)/) || '',
                  description: '',
                  success: true,
                  answer: extractField(/\*\*(?:结果|Answer)\*\*:\s*(.+)/m),
                }
                eventTitle = '子任务完成'
              } else if (c.indexOf('**错误**:') >= 0 || c.indexOf('**Error**:') >= 0) {
                eventType = 'subtask_completed'
                eventData = {
                  session_id: '',
                  agent_name: extractField(/\*\*Agent\*\*: (.+)/) || '',
                  description: '',
                  success: false,
                  error: extractField(/\*\*(?:错误|Error)\*\*:\s*(.+)/m),
                }
                eventTitle = '子任务失败'
              }
            }
          }
          break
      }

      // tokenUsage 合并：本轮最终回复（assistant 无 tool_calls）并入 pendingUsage
      let mergedTokenUsage: ChatMessage['tokenUsage'] = msg.token_usage
        ? {
            prompt_tokens: msg.token_usage.prompt_tokens,
            completion_tokens: msg.token_usage.completion_tokens,
            total_tokens: msg.token_usage.total_tokens,
            cached_tokens: msg.token_usage.cached_tokens,
            reasoning_tokens: msg.token_usage.reasoning_tokens,
          }
        : undefined
      let mergedCost = msg.cost
      if (msg.role === 'assistant' && pendingUsage) {
        const selfCount = msg.token_usage ? 1 : 0
        if (mergedTokenUsage) {
          mergedTokenUsage.prompt_tokens += pendingUsage.prompt_tokens
          mergedTokenUsage.completion_tokens += pendingUsage.completion_tokens
          mergedTokenUsage.total_tokens += pendingUsage.total_tokens
          mergedTokenUsage.cached_tokens = (mergedTokenUsage.cached_tokens || 0) + pendingUsage.cached_tokens
          mergedTokenUsage.reasoning_tokens = (mergedTokenUsage.reasoning_tokens || 0) + pendingUsage.reasoning_tokens
          mergedTokenUsage.call_count = pendingUsage.call_count + selfCount
        } else {
          mergedTokenUsage = {
            prompt_tokens: pendingUsage.prompt_tokens,
            completion_tokens: pendingUsage.completion_tokens,
            total_tokens: pendingUsage.total_tokens,
            cached_tokens: pendingUsage.cached_tokens,
            reasoning_tokens: pendingUsage.reasoning_tokens,
            call_count: pendingUsage.call_count,
          }
        }
        mergedCost = (mergedCost || 0) + pendingUsage.cost
        pendingUsage = null
      }

      if (!skipRestorePush) {
        restored.push({
          id: `restored_${idx}_${msg.timestamp}`,
          role,
          content: msg.content || '',
          ...(msg.images && msg.images.length > 0 ? { images: msg.images } : {}),
          eventType,
          eventTitle,
          eventData,
          metadata: {
            backendTimestamp: msgTimestamp,
            // 透传 OpenAI 协议原值终止原因：恢复历史时据此精确判定最终答案
            ...(msg.finish_reason ? { finish_reason: msg.finish_reason } : {}),
          },
          tokenUsage: mergedTokenUsage,
          actualTokens: msg.actual_tokens,
          cost: mergedCost,
          timestamp: new Date(msg.timestamp).toISOString(),
          sessionId,
        })
      }
      prevTimestamp = msgTimestamp
    }

    // 补齐被压缩滑动窗口清掉的子任务卡片：快照中已无 SubAgent 调用记录、
    // 但本地登记里存在的子任务，按派发时间升序插入消息流开头（restore 三路合成）
    const persisted = loadPersistedSubtasks(sessionId)
    const missingSubtasks = persisted
      .filter((p) => p.session_id && !restoredSpawnedIDs.has(p.session_id))
      .sort((a, b) => a.spawned_at - b.spawned_at)
    if (missingSubtasks.length > 0) {
      const missingCards: ChatMessage[] = missingSubtasks.map((p) => ({
        id: `restored_persisted_subtask_${p.session_id}`,
        role: 'system',
        content: '',
        eventType: 'subtask_spawned',
        eventTitle: '子任务',
        eventData: {
          session_id: p.session_id,
          agent_name: p.agent_name,
          description: p.description,
          success: p.success,
          answer: p.answer || '',
          error: p.error || '',
        },
        metadata: { phase: 'subtask_spawned' },
        timestamp: new Date(p.spawned_at).toISOString(),
        sessionId,
      }))
      restored.unshift(...missingCards)
    }

    messagesBySession[sessionId] = restored
  }

  // ---------- 发送 / 停止 / 重试 / 回退 ----------

  /** user.message 通知发送（desktop services/websocket.sendMessage 同帧构造，附录 C.3） */
  function notifyUserMessage(
    text: string,
    sessionId?: string,
    images?: Array<{ path: string; media_type: string }>,
  ): boolean {
    const params: Record<string, unknown> = { text }
    if (sessionId) params.session_id = sessionId
    if (images && images.length > 0) params.images = images
    return daemon.notify('user.message', params)
  }

  /**
   * 发送前的会话保障（desktop ensureSessionForSend 语义）：无活动会话时以当前
   * Agent + 当前工作目录懒建会话并切换。目录缺位返回 false（desktop 同语义：
   * 无工作目录不可发送，由宿主提示）。
   */
  /** 懒建在飞登记：两次 RPC await 间隙内连击发送复用同一 Promise，防重复建会话 */
  let ensureSessionInflight: Promise<boolean> | null = null

  async function ensureSessionForSend(): Promise<boolean> {
    if (activeSessionId.value) return true
    if (ensureSessionInflight) return ensureSessionInflight
    ensureSessionInflight = doEnsureSessionForSend()
    try {
      return await ensureSessionInflight
    } finally {
      ensureSessionInflight = null
    }
  }

  async function doEnsureSessionForSend(): Promise<boolean> {
    const agent = currentAgent.value
    const dir = (currentProjectDir.value || '').replace(/\/+$/, '')
    if (!agent || !dir) {
      // work 无目录选择 UI，工作区由 hero 工作区选择 chip 显式就位，不自动猜测
      // 落点（用户定稿）；Agent 由 Tasks 节切换器就位。
      lastError.value = !agent ? '尚未选择智能体' : '请先选择工作区'
      return false
    }
    try {
      const created = await daemon.call<{
        session_id: string
        agent_name?: string
        created_at?: string
        session_dir?: string
      }>('session.create', { agent, project_dir: dir })
      const now = new Date().toISOString()
      sessions.value.unshift({
        session_id: created.session_id,
        agent_name: agent,
        title: '',
        created_at: created.created_at || now,
        updated_at: now,
        message_count: 0,
        project_dir: dir,
        // 会话沙箱目录：图片粘贴即落盘依赖此字段
        session_dir: created.session_dir,
      })
      await switchToSession(created.session_id)
      return true
    } catch (err) {
      console.warn('[ChatFlow] 发消息前自动创建会话失败:', err)
      // 真实原因透传（此前被吞，宿主 toast 只剩「消息发送失败」兜底文案）
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  /**
   * 可选工作区（历史会话落点目录去重，按最近使用保序）：hero 工作区选择器数据源。
   */
  const workspaces = computed(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const s of sessions.value) {
      const dir = (s.project_dir || '').replace(/\/+$/, '')
      if (dir && !seen.has(dir)) {
        seen.add(dir)
        list.push(dir)
      }
    }
    return list
  })

  /**
   * 添加工作区：弹系统级目录选择对话框（fs.choose_dir，daemon 原生 NSOpenPanel/
   * FolderBrowserDialog/zenity），选中后经 openLatestByDir 一步就位（有会话切最近
   * 会话，无会话记住目录供懒建）。用户取消返回 null。
   */
  async function chooseWorkspace(): Promise<string | null> {
    try {
      const res = await daemon.call<{ path: string }>('fs.choose_dir', {})
      const dir = (res?.path || '').replace(/\/+$/, '')
      if (!dir) return null
      await openLatestByDir(dir)
      return dir
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  /** 发送消息到活动会话（含懒建会话；返回是否已发出） */
  async function sendMessage(
    text: string,
    images?: Array<{ path: string; media_type: string }>,
  ): Promise<{ sent: boolean }> {
    let targetSessionId = activeSessionId.value
    if (!targetSessionId) {
      const ready = await ensureSessionForSend()
      if (!ready || !activeSessionId.value) return { sent: false }
      targetSessionId = activeSessionId.value
    }

    addUserMessage(targetSessionId, text, images)
    // 新消息开始新一轮：重置「本轮已结束」标记，等待新的 loop_end(completed)
    sessionLoopEnded[targetSessionId] = false
    const msgs = messagesBySession[targetSessionId]
    pendingBackendTsUserBySession[targetSessionId] = msgs?.[msgs.length - 1]?.id || ''

    if (daemon.state !== 'connected') {
      lastError.value = '尚未连接到智能主机'
      return { sent: false }
    }
    if (!notifyUserMessage(text, targetSessionId, images)) {
      lastError.value = '尚未连接到智能主机'
      return { sent: false }
    }
    isProcessing.value = true
    busySessions[targetSessionId] = true
    return { sent: true }
  }

  /** 停止指定会话执行（停止按钮）：message.cancel + 本地执行中工具标记已取消 */
  function stopProcessing(sessionId?: string): void {
    const target = sessionId || activeSessionId.value
    void daemon.call('message.cancel', { session_id: target }).catch((err) => {
      console.warn('[ChatFlow] 取消执行失败:', err)
    })

    if (target) {
      const messages = messagesBySession[target]
      for (const msg of messages ?? []) {
        if (msg.eventType === 'tool_exec' && msg.eventData?.status === 'executing') {
          msg.eventData.status = 'failed'
          msg.eventData.end = {
            success: false,
            error: '用户已取消',
            tool_name: msg.eventTitle || '',
          }
        }
      }
      busySessions[target] = false
    }

    // 仅当停止的是当前活跃会话时才清全局标志
    if (!sessionId || sessionId === activeSessionId.value) {
      isProcessing.value = false
      isQueued.value = false
    }
  }

  /**
   * 错误重试：截断服务端会话到最后一条 user 消息（session.truncate），
   * 本地移除末轮，再重发原 user 消息。
   */
  async function retryFromError(errorMessageId: string): Promise<void> {
    const targetSessionId = activeSessionId.value
    const msgs = messagesBySession[targetSessionId]
    if (!msgs || msgs.length === 0) return

    const errIdx = msgs.findIndex((m) => m.id === errorMessageId)
    if (errIdx < 0) return

    let userIdx = -1
    for (let i = errIdx - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user') {
        userIdx = i
        break
      }
    }
    if (userIdx < 0) return

    const lastUserMsg = msgs[userIdx]
    if (!lastUserMsg) return
    const lastUserContent = lastUserMsg.content

    // step 1: 服务端截断，daemon 不再看得到失败的这轮
    try {
      await daemon.call('session.truncate', { session_id: targetSessionId })
    } catch (err) {
      console.warn('[ChatFlow] session.truncate 失败，仍然重试:', err)
    }

    // step 2: 本地移除最后一条 user 消息起的所有消息（旧 user + 回复 + 错误）
    messagesBySession[targetSessionId] = msgs.slice(0, userIdx)
    isProcessing.value = false
    isQueued.value = false

    // step 3: 经 sendMessage 重发（懒建判定 + user 轮追加 + 通知发送）
    await sendMessage(lastUserContent)
  }

  // ---------- 图片与输入辅助（desktop services/imageUpload RPC 部分平移）----------

  /** 上传结果：绝对路径 + MIME 类型 */
  interface UploadedImage {
    path: string
    mediaType: string
  }

  /**
   * 上传图片到会话临时目录（fs.write_base64）：base64 由调用方（ChatInput 的
   * blob→base64）完成，这里负责落盘与路径拼装（{session_dir}/tmp/{ts}-{rand}.{ext}）。
   * 必须经 daemon RPC 落盘而非客户端直写：远程模式下会话目录是 daemon 侧路径。
   * session_dir 分隔符照 daemon 返回值智能拼接（desktop Windows/WSL2 场景同款）。
   */
  async function uploadImageToSessionTmp(base64: string, mime: string, sessionDir: string): Promise<UploadedImage> {
    if (!sessionDir) {
      throw new Error('会话目录未知，无法保存图片')
    }
    // 文件名：时间戳 + 6 位随机串，避免同毫秒粘贴多图冲突
    const rand = Math.random().toString(36).substring(2, 8)
    const fileName = `${Date.now()}-${rand}.${extFromMime(mime)}`
    const sep = sessionDir.includes('\\') ? '\\' : '/'
    const path = `${sessionDir.replace(/[\\/]+$/, '')}${sep}tmp${sep}${fileName}`
    await daemon.call('fs.write_base64', { path, content: base64 })
    return { path, mediaType: mime }
  }

  // data URL 缓存：同一路径（实时消息 + 历史恢复）只读一次
  const imageDataUrlCache = new Map<string, string>()

  /** 按绝对路径加载图片为 data URL（fs.read_base64），带缓存；读取失败抛错由调用方降级展示 */
  async function loadImageAsDataUrl(path: string): Promise<string> {
    const cached = imageDataUrlCache.get(path)
    if (cached) return cached

    const result = await daemon.call<{ content: string; mime: string }>('fs.read_base64', { path })
    const mime = result?.mime || mimeFromPath(path)
    const url = `data:${mime};base64,${result?.content || ''}`
    imageDataUrlCache.set(path, url)
    return url
  }

  /** 输入优化（optimize.rpc）：返回优化后文本，调用方回填编辑器 */
  async function optimizeText(text: string): Promise<string> {
    const result = await daemon.call<{ text: string }>('optimize.rpc', { text })
    return result?.text ?? text
  }

  /** 删除文件（fs.rm，recurse）：未发送即移除的附件图清理会话临时目录落盘文件 */
  async function removeFile(path: string): Promise<void> {
    await daemon.call('fs.rm', { path, recurse: true })
  }

  // ---------- 模型列表与切换（model.list / provider.list / model.switch / user.config，desktop connectionStore 同构）----------
  /** 可选模型全字段列表（ModelSelector 分组数据源 + NoModel 判定） */
  const models = ref<ModelInfo[]>([])
  /** 供应商原始配置（provider.list；ModelSelector 以 api_key===true && base_url 判定已配置） */
  const rawProviders = ref<ProviderInfo[]>([])
  /** provider → title 映射（formatProviderTitle 数据源） */
  const providerTitleMap = ref<Record<string, string>>({})
  /** 当前生效模型（裸名；与 currentModelProvider 共同构成唯一身份，跨供应商同名可消歧） */
  const currentModelName = ref('')
  const currentModelProvider = ref('')

  /** 拉取模型列表（model.list 全字段映射，desktop connectionStore.fetchModels 同构）；失败置空由 NoModel 判定呈现，不弹全局错误 */
  async function fetchModels(): Promise<void> {
    try {
      const result = await daemon.call<ModelInfo[]>('model.list', {})
      models.value = (Array.isArray(result) ? result : []).map((m) => ({
        name: m.name,
        title: m.title || m.name,
        description: m.description,
        provider: m.provider,
        enabled: m.enabled !== false,
        context_length: m.context_length,
        is_local: m.is_local,
      }))
    } catch (err) {
      console.warn('[ChatFlow] 模型列表拉取失败:', err)
    }
  }

  /** 拉取供应商列表（provider.list；title 进映射表供分组标题显示） */
  async function fetchProviders(): Promise<void> {
    try {
      const result = await daemon.call<ProviderInfo[]>('provider.list', {})
      if (Array.isArray(result)) {
        rawProviders.value = result
        const map: Record<string, string> = {}
        for (const p of result) {
          if (p.title && p.name) map[p.name] = p.title
        }
        providerTitleMap.value = map
      }
    } catch (err) {
      console.warn('[ChatFlow] 供应商列表拉取失败:', err)
    }
  }

  /** 供应商显示名（desktop connectionStore.formatProviderTitle 同构：映射表 → 首字母大写回落） */
  function formatProviderTitle(provider: string): string {
    return providerTitleMap.value[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
  }

  /**
   * 初始化当前模型（desktop ActivityPane L245-266 同构）：以服务端用户配置为
   * 权威来源——优先 last_model，为空或已失效回落 default_model；参照字段可能
   * 是组合串（Provider/Name）也可能是裸名，两种形态都匹配。work 无 monaco
   * 本地缓存体系，该兜底层不移植。
   */
  async function resolveCurrentModel(): Promise<void> {
    try {
      const cfg = await daemon.call<Record<string, any>>('user.config', {})
      const matchBy = (key?: string): ModelInfo | undefined => {
        if (!key) return undefined
        const slash = key.indexOf('/')
        if (slash > 0) {
          return models.value.find(
            (m) => m.provider === key.slice(0, slash) && m.name === key.slice(slash + 1)
          )
        }
        return models.value.find((m) => m.name === key)
      }
      const hit = [cfg?.last_model, cfg?.default_model].map(matchBy).find(Boolean)
      if (hit) {
        currentModelName.value = hit.name
        currentModelProvider.value = hit.provider
      }
    } catch (err) {
      console.warn('[ChatFlow] 当前模型解析失败:', err)
    }
  }

  /**
   * 模型目录刷新链：models → providers → 当前模型解析（顺序依赖：解析匹配需要
   * models 就位）。两个入口：①ChatFlowPage.fetchInitialData 连接后初始化；
   * ②ModelSelector 打开选择器时刷新——models 插件与 chatflow 是各自缓存的
   * 两个消费者（daemon 无变更推送），打开时刻拉取保证供应商配置侧的新增/
   * 删除/启停即时反映到选择器。
   */
  async function refreshModelCatalog(): Promise<void> {
    await fetchModels()
    await fetchProviders()
    await resolveCurrentModel()
  }

  /** 连接后模型初始化（与刷新同链单一实现） */
  async function initModels(): Promise<void> {
    await refreshModelCatalog()
  }

  /**
   * 切换模型（model.switch {name, provider}，desktop connectionStore.switchModel 同构）：
   * 成功即更新本地当前模型，并按组合串（Provider/Name）持久化 last_model 到服务端
   * 用户配置——重启/断连重连后仍恢复上次选择；失败抛出由调用方提示。
   */
  async function switchModel(name: string, provider?: string): Promise<void> {
    await daemon.call<{ name: string; provider: string; message: string }>('model.switch', {
      name,
      provider,
    })
    currentModelName.value = name
    currentModelProvider.value = provider || ''
    try {
      await daemon.call('user.config', { last_model: provider ? `${provider}/${name}` : name })
    } catch (err) {
      console.warn('[ChatFlow] last_model 持久化失败:', err)
    }
    // 切换后立即刷新活动会话的上下文用量：分母（max_window_size）随当前模型变化，
    // 而 context_usage 事件仅在轮次结束时推送——不主动拉取，指示器会一直显示
    // 旧模型的窗口分母（2026-09-28 实证：1M 模型切过来仍显示 204.8K/129%）
    await refreshContextUsage()
  }

  /**
   * 拉取活动会话的上下文用量（session.context：daemon 经 modelContextResolver
   * 动态查询当前默认模型的窗口大小）。无活动会话静默跳过；失败仅告警不抛出
   * （指示器下一次轮次结束的事件仍会纠偏）。
   */
  async function refreshContextUsage(): Promise<void> {
    const sid = activeSessionId.value
    if (!sid) return
    try {
      const usage = await daemon.call<{
        session_id: string
        window_tokens: number
        max_window_size: number
        usage_ratio: number
        message_count: number
        cursor: number
        active_message_count: number
        total_actual_tokens: number
        total_cost: number
      }>('session.context', { session_id: sid })
      if (sid !== activeSessionId.value) return // 会话已切走，过期响应丢弃
      contextUsage.value = {
        window_tokens: usage.window_tokens ?? 0,
        max_window_size: usage.max_window_size ?? 0,
        usage_ratio: usage.usage_ratio ?? 0,
        message_count: usage.message_count ?? 0,
        cursor: usage.cursor ?? 0,
        active_message_count: usage.active_message_count ?? 0,
        total_actual_tokens: usage.total_actual_tokens ?? 0,
        total_cost: usage.total_cost ?? 0,
      }
    } catch (err) {
      console.warn('[ChatFlow] 上下文用量刷新失败:', err)
    }
  }

  /**
   * 移除单条消息（ErrorView「忽略并继续」）：仅改本地视图，后端无对应删除
   *（desktop ChatArea.handleDismiss 同构）。
   */
  function dismissMessage(sessionId: string, messageId: string): void {
    const msgs = messagesBySession[sessionId]
    if (!msgs) return
    const idx = msgs.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    msgs.splice(idx, 1)
  }

  /**
   * 回收本轮（回退轮）：session.delete_round {session_id, id: backendTimestamp}，
   * 成功后同步本地视图——从该 user 消息起、到下一个 user 消息（不含）为止整轮移除，
   * 轮次边界与后端一致。
   */
  async function deleteRound(sessionId: string, backendTs: number): Promise<boolean> {
    if (!sessionId || !backendTs) return false
    try {
      await daemon.call('session.delete_round', { session_id: sessionId, id: backendTs })
    } catch (err) {
      console.warn('[ChatFlow] 回收本轮失败:', err)
      return false
    }
    const msgs = messagesBySession[sessionId]
    if (!msgs || msgs.length === 0) return true
    const startIdx = msgs.findIndex((m) => m.role === 'user' && m.metadata?.backendTimestamp === backendTs)
    if (startIdx < 0) return true
    let endIdx = startIdx + 1
    while (endIdx < msgs.length && msgs[endIdx]?.role !== 'user') {
      endIdx++
    }
    messagesBySession[sessionId] = [...msgs.slice(0, startIdx), ...msgs.slice(endIdx)]
    return true
  }

  /** 会话标题编辑（session.rename；title 置空回退自动补录语义） */
  async function renameSession(sessionId: string, title: string): Promise<void> {
    await daemon.call('session.rename', { session_id: sessionId, title })
    const target = sessions.value.find((s) => s.session_id === sessionId)
    if (target) target.title = title
  }

  /**
   * 删除会话（session.delete）：本地清单同步移除；删的是当前会话时清空对话流
   * 回到新会话态（保留目录与 Agent，会话懒建于首条消息发送时）
   */
  async function deleteSession(sessionId: string): Promise<void> {
    await daemon.call('session.delete', { session_id: sessionId })
    sessions.value = sessions.value.filter((s) => s.session_id !== sessionId)
    if (activeSessionId.value === sessionId) {
      clearActiveStream()
    }
  }

  // ---------- 上下文用量 ----------

  /** session.context → ContextUsageInfo（输入区 ContextUsageGauge 数据源；仅活动会话） */
  async function fetchContextUsage(sessionId?: string): Promise<void> {
    const target = sessionId || activeSessionId.value
    if (!target) return
    try {
      const data = await daemon.call<Partial<ContextUsageInfo> | null>('session.context', { session_id: target })
      if (data && target === activeSessionId.value) {
        contextUsage.value = {
          window_tokens: data.window_tokens ?? 0,
          max_window_size: data.max_window_size ?? 0,
          usage_ratio: data.usage_ratio ?? 0,
          message_count: data.message_count ?? 0,
          cursor: data.cursor ?? 0,
          active_message_count: data.active_message_count ?? 0,
          total_actual_tokens: data.total_actual_tokens ?? 0,
          total_cost: data.total_cost ?? 0,
        }
      }
    } catch (err) {
      console.warn('[ChatFlow] 上下文用量拉取失败:', err)
    }
  }

  // ---------- 阻塞交互（授权 / 提问）----------

  /**
   * 授权同意：发送 PermissionAllow / PermissionAllowSession 魔术词（附录 C.3，
   * desktop ChatArea.handlePermissionGrant 同构）。子会话授权冒泡时魔术词携带
   * 发起授权的子会话 ID（'PermissionAllow: <sid>'），发送目标必须是 sponsor 主会话
   *（子会话决策只能由主会话 exec 的 resolvePermissionMagicWord 路由）。
   */
  function grantPermission(payload: { tool_name?: string; remember?: boolean; session_id?: string }): void {
    if (!payload.tool_name && !pendingPermissionToolName.value) {
      console.warn('[ChatFlow] 无待授权工具名，忽略授权')
      return
    }
    const sessionId = activeSessionId.value
    if (!sessionId) return

    pendingPermissionToolName.value = ''
    const target = (payload.session_id && subSessionSponsor[payload.session_id]) || sessionId
    const suffix = payload.session_id ? ': ' + payload.session_id : ''
    const magicWord = (payload.remember ? 'PermissionAllowSession' : 'PermissionAllow') + suffix
    if (notifyUserMessage(magicWord, target)) {
      isProcessing.value = true
    }
  }

  /** 授权拒绝：PermissionDeny 魔术词（Agent 据此调整方案而非戛然而止），路由规则同 grantPermission */
  function denyPermission(payload: { tool_name?: string; session_id?: string }): void {
    if (!payload.tool_name && !pendingPermissionToolName.value) {
      console.warn('[ChatFlow] 无待授权工具名，忽略拒绝')
      return
    }
    const sessionId = activeSessionId.value
    if (!sessionId) return

    pendingPermissionToolName.value = ''
    const target = (payload.session_id && subSessionSponsor[payload.session_id]) || sessionId
    const suffix = payload.session_id ? ': ' + payload.session_id : ''
    if (notifyUserMessage('PermissionDeny' + suffix, target)) {
      isProcessing.value = true
    }
  }

  /**
   * 回答子代理提问（主界面吸底交互区直接作答）：回答作为 user 消息落入子会话流
   * （阻塞扫描碰到 user 消息即判定已响应），并经 user.message 携带子会话 ID 发送
   * ——daemon dispatchAskAnswer 按 SessionID 命中挂起子 exec 注入回答。
   */
  function answerSubagentAsk(subSessionId: string, text: string): void {
    if (!subSessionId || !text) return
    addMessage(subSessionId, { role: 'user', content: text })
    notifyUserMessage(text, subSessionId)
  }

  // ---------- 流式缓冲 ----------

  /** 把微缓冲文本落地到消息流：追加到尾随 assistant markdown 消息，没有则新建 */
  function appendStreamBuffer(sessionId: string): void {
    const buf = pendingContentBySession[sessionId]
    if (!buf) return
    delete pendingContentBySession[sessionId]
    const messages = messagesBySession[sessionId] || []
    const last = messages[messages.length - 1]
    if (last && last.role === 'assistant' && last.eventType === 'markdown') {
      // 尾随消息仍是本轮流式输出 → 原地追加（保持单一消息，避免碎片化）
      last.content += buf
    } else {
      // 中间被工具/组件等消息打断 → 开启新的流式输出段
      addMessage(sessionId, { role: 'assistant', content: buf, eventType: 'markdown' })
    }
  }

  /**
   * 立即落地微缓冲（清节流定时器后 appendStreamBuffer）。AskUser / 授权等交互
   * 组件是即时入列的，插入前必须先落缓冲，否则组件会插到已到达文字前面。
   */
  function flushPendingContent(sessionId: string): void {
    const timer = streamFlushTimers[sessionId]
    if (timer) {
      clearTimeout(timer)
      delete streamFlushTimers[sessionId]
    }
    appendStreamBuffer(sessionId)
  }

  // ---------- 事件订阅归一（desktop connectionStore L631-944 订阅清单） ----------

  function onEvent(method: string, handler: (envelope: EventEnvelope) => void): void {
    daemon.onNotification(method, (params) => handler((params || {}) as EventEnvelope))
  }

  /** 事件会话归属：envelope.session_id 缺省回退活动会话 */
  function targetSessionOf(envelope: EventEnvelope): string {
    return envelope.session_id || activeSessionId.value
  }

  // user_message_saved：回传持久化 Timestamp，回填本地 user 消息的 backendTimestamp
  onEvent('user_message_saved', (envelope) => {
    const sid = targetSessionOf(envelope)
    const ts = envelope.data?.timestamp
    if (sid && typeof ts === 'number' && ts > 0) patchLastUserMessageTimestamp(sid, ts)
  })

  // message_queued：消息已进入会话串行队列（上一轮 CollectResults 等长耗时工具仍在运行）。
  // busySessions 不限激活会话：后台会话（含其它端发起）也要点亮侧栏运行指示
  onEvent('message_queued', (envelope) => {
    const sid = targetSessionOf(envelope)
    if (sid) busySessions[sid] = true
    if (sid !== activeSessionId.value) return
    isQueued.value = true
  })

  // message_processing：排队中的消息已开始执行（同上：busy 全局点亮，激活态字段仅活动会话）
  onEvent('message_processing', (envelope) => {
    const sid = targetSessionOf(envelope)
    if (sid) busySessions[sid] = true
    if (sid !== activeSessionId.value) return
    isQueued.value = false
  })

  // thinking_delta：按会话累积增量写入（子会话事件写子会话自己的消息流）
  onEvent('thinking_delta', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleThinkingDelta(envelope.data, sid)
  })

  // thinking_done：思考正文只来自 thinking_delta 累积（事件 data 是提示文本非正文）
  onEvent('thinking_done', (envelope) => {
    handleThinkingDone(targetSessionOf(envelope))
  })

  // markdown / content_delta：同一节流归一路径（120ms 合并落屏）
  onEvent('markdown', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleContentDelta(envelope.data, sid)
  })
  onEvent('content_delta', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleContentDelta(envelope.data, sid)
  })

  // tool_use_delta：LLM 流式输出工具调用参数（先于 tool_exec_start 到达）
  onEvent('tool_use_delta', (envelope) => {
    handleToolUseDelta(envelope.data, targetSessionOf(envelope))
  })

  // tool_exec_start：工具即将开始执行（AskUser 有专用视图，跳过避免重复显示）
  onEvent('tool_exec_start', (envelope) => {
    const toolName = envelope.data?.tool_name || envelope.title || ''
    if (toolName === 'AskUser') return
    handleToolExecStart(envelope.data, targetSessionOf(envelope), envelope.title)
  })

  // tool_exec_end：工具执行结束（成功或失败），按 tool_call 语义归位最后一条 executing
  onEvent('tool_exec_end', (envelope) => {
    handleToolExecEnd(envelope.data, targetSessionOf(envelope))
  })

  // file_open：Agent-Driven UI 命令（mindx ui open）广播，走既有分发表打开对应 Detail
  onEvent('file_open', (envelope) => {
    const p = envelope.data?.path
    if (typeof p === 'string' && p) void openFile(p)
  })

  // subtask_spawned：主会话流插入观察窗卡片 + sponsor 登记 + localStorage 登记
  onEvent('subtask_spawned', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleSubtaskSpawned(envelope.data, sid, envelope.title)
  })

  // subtask_completed：按子会话 ID 路由写入子会话流（单一数据源）
  onEvent('subtask_completed', (envelope) => {
    const sid = envelope.data?.session_id || envelope.session_id || activeSessionId.value
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleSubtaskCompleted(envelope.data, sid)
  })

  // ask_user_request：子代理 AskUser 冒泡，写入子会话流（主界面吸底区直接作答）
  onEvent('ask_user_request', (envelope) => {
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    handleSubagentAskUserRequest(envelope.data, envelope.data?.session_id || '', agentName)
  })

  // final_answer：仅做活动会话的处理状态收尾（子会话/后台会话不影响主视图状态）
  onEvent('final_answer', (envelope) => {
    const sid = targetSessionOf(envelope)
    if (sid && sid !== activeSessionId.value) return
    isProcessing.value = false
  })

  // permission_request：阻塞事件写入所属会话流（子会话冒泡时 data.session_id 为子会话）
  onEvent('permission_request', (envelope) => {
    const sid = envelope.data?.session_id || envelope.session_id || activeSessionId.value
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handlePermissionRequest(envelope.data, sid, envelope.title)
  })

  onEvent('permission_denied', (envelope) => {
    const sid = envelope.data?.session_id || envelope.session_id || activeSessionId.value
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handlePermissionDenied(envelope.data, sid)
  })

  // form：AskUser 阻塞（主会话直接入流；子会话冒泡写子会话流）
  onEvent('form', (envelope) => {
    const sid = envelope.data?.session_id || envelope.session_id || activeSessionId.value
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleAskUserRequest(envelope.data, sid, envelope.title)
  })

  // loop_end：一次 Think-Act 循环结束；termination_reason=completed 置轮收拢标记，
  // 其它值（max_tokens/cancelled 等）不触发收尾（保留现场）
  onEvent('loop_end', (envelope) => {
    const sid = targetSessionOf(envelope)
    const reason = envelope.data?.termination_reason || ''
    if (reason === 'completed' && sid) {
      sessionLoopEnded[sid] = true
      markUnread(sid)
    }
  })

  // task_summary：最终显示（与尾随 markdown 同文去重）；子会话写子会话流
  onEvent('task_summary', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleTaskSummary(envelope.data, sid, envelope.title, envelope.meta)
  })

  // error：错误卡片（含 LLM HTTP 错误分类，供 ErrorView 分流提示）
  onEvent('error', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleError(envelope.data, sid, envelope.title)
    markUnread(sid)
  })

  // context_usage：仅活动会话更新（输入区 ContextUsageGauge 数据源）
  onEvent('context_usage', (envelope) => {
    const sid = targetSessionOf(envelope)
    if (sid === activeSessionId.value && envelope.data) {
      contextUsage.value = {
        window_tokens: envelope.data.window_tokens ?? 0,
        max_window_size: envelope.data.max_window_size ?? 0,
        usage_ratio: envelope.data.usage_ratio ?? 0,
        message_count: envelope.data.message_count ?? 0,
        cursor: envelope.data.cursor ?? 0,
        active_message_count: envelope.data.active_message_count ?? 0,
        total_actual_tokens: envelope.data.total_actual_tokens ?? 0,
        total_cost: envelope.data.total_cost ?? 0,
      }
    }
  })

  // compact_start / compact_done：压缩状态；slid>0 表示后端游标已真实移动，
  // 本地内存缓存必然陈旧——卸载重拉，对话流随服务端窗口一并更新
  onEvent('compact_start', (envelope) => {
    const sid = targetSessionOf(envelope)
    if (sid === activeSessionId.value) isCompacting.value = true
  })
  onEvent('compact_done', (envelope) => {
    const sid = targetSessionOf(envelope)
    if (sid !== activeSessionId.value) {
      // 背景会话压缩后内存缓存必然陈旧（消息已被服务端滑窗）：卸载，下次打开按快照重拉
      if (sid && loadedSessions.has(sid)) unloadSession(sid)
      return
    }
    isCompacting.value = false
    const slid = Number(envelope.data?.messages_slid ?? 0)
    const refetch = async () => {
      if (slid > 0) {
        unloadSession(sid)
        await switchToSession(sid)
      }
      // 压缩卡片在重拉完成后插入，避免 restoreSessionMessages 整体替换时被冲掉
      addMessage(sid, {
        role: 'system',
        content: '',
        eventType: 'compaction',
        eventTitle: '记忆压缩',
        eventData: envelope.data,
        metadata: { phase: 'compaction' },
      })
    }
    void refetch()
  })

  // max_turns_reached：轮数上限提示（后端不发 task_summary 的路径，先落流式缓冲）
  onEvent('max_turns_reached', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleMaxTurnsReached(envelope.data, sid)
    markUnread(sid)
  })

  // llm_cancelled：LLM 调用被用户取消（停止按钮 / 断开连接）
  onEvent('llm_cancelled', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    isProcessing.value = false
    busySessions[sid] = false
    removeLLMRetryNotice(sid)
    addMessage(sid, {
      role: 'system',
      content: '',
      eventType: 'llm_cancelled',
      eventTitle: '已取消',
      eventData: envelope.data,
      metadata: { phase: 'llm_cancelled' },
    })
  })

  // llm_retry：LLM 建流重试（429/5xx 退避等待冒泡）；phase=recovered 自动消除
  onEvent('llm_retry', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleLLMRetry(envelope.data, sid)
  })

  // file_modified：文件变更仅供待确认列表消费，不进入消息流
  onEvent('file_modified', (envelope) => {
    const sid = targetSessionOf(envelope)
    const agentName = typeof envelope.meta?.agent_name === 'string' ? envelope.meta.agent_name : undefined
    if (agentName) sessionCurrentAgentName[sid] = agentName
    handleFileModified(envelope.data, sid)
  })

  // ---------- 事件归一 handlers（desktop chatStore 语义平移） ----------

  function handleThinkingDelta(data: any, sessionId: string): void {
    const messages = messagesBySession[sessionId]
    // 按会话累积增量，避免多会话并行时相互污染
    const accumulated = (thinkingContentBySession[sessionId] || '') + (data || '')
    thinkingContentBySession[sessionId] = accumulated

    let thinkingMsg = messages?.find(
      (m) => m.eventType === 'thinking_delta' || (m.eventType === 'thinking_done' && !m.metadata?.complete),
    )
    if (!thinkingMsg) {
      thinkingMsg = addMessage(sessionId, {
        role: 'assistant',
        content: '',
        eventType: 'thinking_delta',
        eventTitle: '思考中',
        metadata: { complete: false },
      })
    }
    thinkingMsg.content = accumulated
    thinkingMsg.eventType = 'thinking_delta'
  }

  function handleThinkingDone(sessionId: string): void {
    const messages = messagesBySession[sessionId]
    // 思考正文只能来自 thinking_delta 累积流；事件自身 data 是 daemon 的完成提示文本，
    // 不得作为 content 回退显示
    const content = thinkingContentBySession[sessionId] || ''
    let thinkingMsg = messages?.findLast(
      (m) => m.eventType === 'thinking_delta' || (m.eventType === 'thinking_done' && !m.metadata?.complete),
    )
    if (thinkingMsg) {
      thinkingMsg.eventType = 'thinking_done'
      if (!thinkingMsg.content && content) thinkingMsg.content = content
      thinkingMsg.metadata = { ...thinkingMsg.metadata, complete: true }
    } else if (content) {
      // 仅有 thinking_done 无 thinking_delta 时直接创建消息
      addMessage(sessionId, {
        role: 'assistant',
        content,
        eventType: 'thinking_done',
        eventTitle: '思考中',
        metadata: { complete: true },
      })
    }
    delete thinkingContentBySession[sessionId]
  }

  function handleContentDelta(data: any, sessionId: string): void {
    const chunk = typeof data === 'string' ? data : ''
    if (!chunk) return
    pendingContentBySession[sessionId] = (pendingContentBySession[sessionId] || '') + chunk
    // 节流：高频 delta 合并每 120ms 落一次屏，避免逐 token 触发全量 markdown 重渲染
    if (streamFlushTimers[sessionId]) return
    streamFlushTimers[sessionId] = setTimeout(() => {
      delete streamFlushTimers[sessionId]
      appendStreamBuffer(sessionId)
    }, 120)
  }

  function handleToolUseDelta(data: any, sessionId: string): void {
    const messages = messagesBySession[sessionId]
    const toolMsg = messages?.findLast((m) => m.eventType === 'tool_exec' && m.eventData?.status === 'executing')
    if (toolMsg && toolMsg.eventData?.start) {
      // 已有活跃工具执行 → 累积参数到 start.params
      if (!toolMsg.eventData.start.params) toolMsg.eventData.start.params = {}
      if (data?.arguments) {
        const existing = toolMsg.eventData.start.params['arguments'] || ''
        toolMsg.eventData.start.params['arguments'] = existing + data.arguments
      }
      if (data?.name) toolMsg.eventData.start.params['name'] = data.name
      if (data?.id) toolMsg.eventData.start.params['id'] = data.id
    } else {
      // 还没有 tool_exec_start → 暂存（goharness 时序保证：delta 先于 start）
      pendingToolUseDelta = {
        index: data?.index ?? 0,
        id: data?.id || '',
        name: data?.name || '',
        arguments: data?.arguments || '',
      }
    }
  }

  function handleToolExecStart(data: any, sessionId: string, title?: string): void {
    // tool_name 优先级: data.tool_name > pendingToolUseDelta.name > title > 兜底
    const toolName = data?.tool_name || pendingToolUseDelta?.name || title || '工具调用'

    // 直接透传 goharness 原始数据，缓存的 delta 合并 arguments 到 params
    const startData = { ...data }
    if (!startData.tool_name && toolName !== '工具调用') startData.tool_name = toolName
    if (pendingToolUseDelta && !startData.params) {
      try {
        startData.params = JSON.parse(pendingToolUseDelta.arguments)
      } catch {
        startData.params = { arguments: pendingToolUseDelta.arguments }
      }
      pendingToolUseDelta = null
    }

    addMessage(sessionId, {
      role: 'tool',
      content: '',
      eventType: 'tool_exec',
      eventTitle: toolName,
      eventData: { start: startData, end: null, status: 'executing' },
      metadata: { phase: 'active' },
    })
    isProcessing.value = true
  }

  function handleToolExecEnd(data: any, sessionId: string): void {
    const messages = messagesBySession[sessionId]
    const toolMsg = messages?.findLast((m) => m.eventType === 'tool_exec' && m.eventData?.status === 'executing')
    if (toolMsg && toolMsg.eventData) {
      toolMsg.eventData.end = data
      // 失败判定：后端显式 success=false 或 error 字段非空
      const failed = data?.success === false || !!data?.error
      toolMsg.eventData.status = failed ? 'failed' : 'done'

      // CollectResults 结果回填：解析并更新对应 spawned 卡片完成状态 + 持久化
      //（兜底 subtask_completed 事件丢失的场景——结果一定经过主会话流，与恢复链路同构）
      const endToolName = data?.tool_name || toolMsg.eventTitle || ''
      if (endToolName === 'CollectResults' && data?.result) {
        applyCollectResults(sessionId, data.result)
      }
    }
  }

  /** 解析 CollectResults 结果（JSON 数组），回填 spawned 观察窗卡片并写本地持久化登记 */
  function applyCollectResults(sessionId: string, resultJson: string): void {
    let parsed: any = null
    try {
      parsed = JSON.parse(resultJson)
    } catch {
      return
    }
    if (!Array.isArray(parsed)) return
    const messages = messagesBySession[sessionId] || []
    for (const entry of parsed) {
      const sid = entry?.session_id
      if (!sid) continue
      const success = entry.status === 'completed'
      const answer = success ? entry.result || '' : ''
      const error = success ? '' : entry.error || ''
      const card = [...messages].reverse().find(
        (m) => m.eventType === 'subtask_spawned' && m.eventData?.session_id === sid,
      )
      if (card?.eventData) {
        card.eventData.success = success
        card.eventData.answer = answer
        card.eventData.error = error
      }
      persistSubtaskCompletion(sessionId, { session_id: sid, success, answer, error })
    }
  }

  function handleSubtaskSpawned(data: any, sessionId: string, title?: string): void {
    const subSessionId = data?.session_id || ''
    const agentName = data?.agent_name || ''
    // 观察窗卡片仅在主会话流插入一条 subtask_spawned 消息；实时状态由子会话流派生
    if (!subSessionId || !agentName) return

    // 登记 sponsor：子会话授权/提问回答的魔术词据此发往主会话路由
    if (sessionId) subSessionSponsor[subSessionId] = sessionId

    // 子会话进入运行态：侧栏点亮（轮询兜底通道之外的事件级实时点亮）
    if (subSessionId) busySessions[subSessionId] = true

    // 本地持久化：会话快照被压缩窗口清掉 SubAgent 调用后，重载据此补齐卡片
    persistSubtaskSpawn(sessionId, {
      session_id: subSessionId,
      agent_name: agentName,
      description: data?.description || '',
    })

    addMessage(sessionId, {
      role: 'system',
      content: typeof data === 'string' ? data : '',
      eventType: 'subtask_spawned',
      eventTitle: title || '子任务',
      eventData: data,
      metadata: { phase: 'subtask_spawned' },
    })
  }

  function handleSubtaskCompleted(data: any, sessionId: string): void {
    const content = typeof data === 'string' ? data : data?.answer || data?.error || ''
    // 完成事件写入子会话自己的消息流（单一数据源，观察窗从子会话流尾部检测状态）
    // sponsor 优先取 spawn 时的内存映射；刷新后回退用事件所属会话
    const sponsorSessionId = subSessionSponsor[data?.session_id] || sessionId
    // 子会话退出运行态：侧栏熄灭（daemon sponsored 登记已随 spawn 结束清理）
    if (data?.session_id) delete busySessions[data.session_id]
    if (sponsorSessionId && data?.session_id) {
      persistSubtaskCompletion(sponsorSessionId, {
        session_id: data.session_id,
        success: !!data?.success,
        answer: data?.answer || '',
        error: data?.error || '',
      })
    }
    addMessage(sessionId, {
      role: 'system',
      content,
      eventType: 'subtask_completed',
      eventTitle: data?.success ? '子任务完成' : '子任务失败',
      eventData: data,
      metadata: { phase: 'subtask_completed', success: data?.success },
    })
  }

  /** 子代理 AskUser 冒泡：写入子会话流（phase=clarify），主界面吸底区直接作答 */
  function handleSubagentAskUserRequest(data: any, subSessionId: string, agentName?: string): void {
    if (!subSessionId) return
    // 先把子会话此前流式缓冲的文字上屏，保证提问卡片顺序正确
    flushPendingContent(subSessionId)
    addMessage(subSessionId, {
      role: 'system',
      content: '',
      eventType: 'form',
      eventTitle: agentName ? `${agentName} · 需要澄清` : '需要澄清',
      eventData: data,
      metadata: { phase: 'clarify', agent_name: agentName || '' },
    })
  }

  function handlePermissionRequest(data: any, sessionId: string, title?: string): void {
    // 先落此前流式缓冲的说明文字，保证顺序为「文字在上、授权组件在下」
    flushPendingContent(sessionId)

    // 非阻塞权限：记录 tool_name，供授权按钮发送魔术词时兜底
    const toolName = data?.tool_name || data?.toolName || ''
    if (toolName) pendingPermissionToolName.value = toolName

    addMessage(sessionId, {
      role: 'system',
      content: '',
      eventType: 'permission_request',
      eventTitle: title || '需要授权',
      eventData: data,
      metadata: { phase: 'permission' },
    })
  }

  function handlePermissionDenied(data: any, sessionId: string): void {
    // 后端已撤销该授权，清理魔术词兜底状态，防过期授权被误操作触发
    pendingPermissionToolName.value = ''
    addMessage(sessionId, {
      role: 'system',
      content: data || '授权已拒绝',
      eventType: 'permission_denied',
      eventTitle: '授权已拒绝',
      eventData: data,
      metadata: { phase: 'denied' },
    })
  }

  function handleAskUserRequest(data: any, sessionId: string, title?: string): void {
    // 同 permission_request：先落缓冲保证「文字在上、提问组件在下」
    flushPendingContent(sessionId)
    addMessage(sessionId, {
      role: 'system',
      content: '',
      eventType: 'form',
      eventTitle: title || '需要澄清',
      eventData: data,
      metadata: { phase: 'clarify' },
    })
  }

  function handleError(data: any, sessionId: string, title?: string): void {
    const errorContent = data || title || '发生错误'
    // 识别 LLM HTTP 错误类型（429 限流 / 402 欠费等），供 ErrorView 分流提示
    const httpClass = classifyHttpError(errorContent)

    // 出错前已生成的流式文本先落屏，避免随错误一起丢失
    flushPendingContent(sessionId)

    // 客户端不自动重试（重试由服务端 LLM 调用层执行，避免整轮重发造成消息流重复）
    // 去重：最后一条已是相同错误时跳过
    const msgs = messagesBySession[sessionId]
    const lastMsg = msgs?.[msgs.length - 1]
    if (lastMsg?.eventType === 'error' && lastMsg?.content === errorContent) {
      isProcessing.value = false
      busySessions[sessionId] = false
      return
    }

    addMessage(sessionId, {
      role: 'system',
      content: errorContent,
      eventType: 'error',
      eventTitle: title || '错误',
      eventData: data,
      metadata: { phase: 'error', http_class: httpClass || undefined },
    })

    lastError.value = errorContent
    isProcessing.value = false
    busySessions[sessionId] = false
    // 错误意味着重试链路已终止，存留的 LLM 重试警告条随之消除
    removeLLMRetryNotice(sessionId)
  }

  function handleLLMRetry(data: any, sessionId: string): void {
    if (data?.phase === 'recovered') {
      removeLLMRetryNotice(sessionId)
      return
    }
    // 已有警告条则原地更新（第 n 次重试覆盖显示），否则追加
    const msgs = messagesBySession[sessionId]
    const existing = msgs?.find((m) => m.eventType === 'llm_retry')
    if (existing) {
      existing.eventData = data
      return
    }
    addMessage(sessionId, {
      role: 'system',
      content: '',
      eventType: 'llm_retry',
      eventData: data,
      metadata: { phase: 'llm_retry' },
    })
  }

  function removeLLMRetryNotice(sessionId: string): void {
    const msgs = messagesBySession[sessionId]
    if (!msgs) return
    const idx = msgs.findIndex((m) => m.eventType === 'llm_retry')
    if (idx >= 0) msgs.splice(idx, 1)
  }

  function handleMaxTurnsReached(data: any, sessionId: string): void {
    // max_turns 路径后端不发 task_summary：先落屏节流中的流式文本
    flushPendingContent(sessionId)
    addMessage(sessionId, {
      role: 'system',
      content: data?.suggestion || `已达最大轮数 ${data?.turns_completed || '?'}/${data?.max_turns || '?'}`,
      eventType: 'max_turns_reached',
      eventTitle: '已达最大轮数',
      eventData: data,
      metadata: { phase: 'max_turns' },
    })
    isProcessing.value = false
    busySessions[sessionId] = false
  }

  /**
   * task_summary：最终显示。流式内容已实时上屏，若 summary 与尾随 markdown 一致
   * （或为空）不重复加卡片，把本轮 token 统计合并到尾随消息；阻塞等待授权/提问时
   *（流尾为 permission_request/form）的摘要不落库渲染，避免污染消息流。
   */
  function handleTaskSummary(data: any, sessionId: string, title?: string, meta?: Record<string, unknown>): void {
    const summaryText = typeof data === 'string' ? data : data?.summary || data || ''

    // 先落地残余流式文本，再判断与尾随 markdown 是否重复
    flushPendingContent(sessionId)
    const messages = messagesBySession[sessionId] || []
    const last = messages[messages.length - 1]
    const trailingIsStream = !!last && last.role === 'assistant' && last.eventType === 'markdown'
    const duplicated = trailingIsStream && (!summaryText || last.content.trim() === summaryText.trim())

    // 会话正处于阻塞时（流尾为 permission_request/form 且其后无 user/最终答案），
    // 后端紧接着发来的「等待授权」摘要对用户无意义，不落库渲染
    let blockedOnInteraction = false
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m) continue
      if (m.eventType === 'permission_request' || m.eventType === 'form') {
        blockedOnInteraction = true
        break
      }
      if (m.role === 'user' || m.eventType === 'final_answer' || m.eventType === 'markdown') break
    }

    const promptTokens = meta?.prompt_tokens || data?.token_usage?.prompt_tokens || data?.prompt_tokens || 0
    const completionTokens = meta?.completion_tokens || data?.token_usage?.completion_tokens || data?.completion_tokens || 0
    const cacheTokens = meta?.cached_tokens || data?.token_usage?.cached_tokens || data?.cached_tokens || 0
    // total_tokens 保持与后端一致：原始 API 返回的 prompt + completion
    const totalTokens = promptTokens + completionTokens
    const actualTokens = Math.max(0, totalTokens - cacheTokens)
    const cost = data?.cost || data?.token_usage?.cost || 0

    if (blockedOnInteraction) {
      // 阻塞等待期间的摘要卡片不落库，直接跳过渲染
    } else if (duplicated && last) {
      last.tokenUsage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cached_tokens: cacheTokens,
        call_count: 1,
      }
      last.actualTokens = actualTokens
      last.cost = (last.cost || 0) + cost
    } else {
      addMessage(sessionId, {
        role: 'assistant',
        content: summaryText,
        eventType: 'task_summary',
        eventTitle: title || '任务总结',
        eventData: data,
        metadata: {
          phase: 'summary',
          promptTokens,
          completionTokens,
          cacheTokens,
          totalTokens,
          actualTokens,
        },
        tokenUsage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cached_tokens: cacheTokens,
        },
        actualTokens,
        cost,
      })
    }

    // 子会话的 task_summary 只标记该子会话空闲，不影响主会话处理状态
    if (sessionId && sessionId === activeSessionId.value) {
      isProcessing.value = false
    }
    busySessions[sessionId] = false
  }

  // ---------- 待确认文件（file_modified 数据面，FileReviewBar 消费） ----------

  /** 工具执行后文件变更通知：按会话 upsert 并持久化（事件在执行「前」触发，
   *  已有条目保留原 diff，覆盖成空 diff 会让已有快照降级） */
  function handleFileModified(data: any, sessionId: string): void {
    const rawFiles: any[] = data?.files || []
    const files = rawFiles.map((f: any) =>
      typeof f === 'string'
        ? { path: f, diff: '', additions: 0, deletions: 0, isNew: false }
        : {
            path: f.path || '',
            diff: f.diff || '',
            additions: f.additions || 0,
            deletions: f.deletions || 0,
            isNew: f.isNew || false,
          },
    )
    const list = pendingFileModificationsBySession[sessionId] || (pendingFileModificationsBySession[sessionId] = [])
    for (const file of files) {
      const idx = list.findIndex((f) => f.path === file.path)
      if (idx >= 0) {
        if (file.diff) list[idx] = file
      } else {
        list.push(file)
      }
    }
    persistPendingFilesMap(pendingFileModificationsBySession)
  }

  /** 会话加载时用后端 modify_files 恢复列表（整体替换语义：以服务器为准，
   *  服务器已不存在的残留条目一并清除；files 缺省视为拉取失败保持现状） */
  function setPendingFilesFromServer(sessionId: string, files?: PendingFileMod[]): void {
    if (!sessionId || !files) return
    const list = pendingFileModificationsBySession[sessionId] || (pendingFileModificationsBySession[sessionId] = [])
    const serverPaths = new Set<string>()
    for (const f of files) {
      if (!f || !f.path) continue
      serverPaths.add(f.path)
      const entry: PendingFileMod = {
        path: f.path,
        diff: f.diff || '',
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        isNew: !!f.isNew,
      }
      const idx = list.findIndex((x) => x.path === entry.path)
      if (idx >= 0) list[idx] = entry
      else list.push(entry)
    }
    for (let i = list.length - 1; i >= 0; i--) {
      // 无 path 的残缺条目视为服务端已删除（'' 不会出现在 serverPaths）
      if (!serverPaths.has(list[i]?.path || '')) list.splice(i, 1)
    }
    persistPendingFilesMap(pendingFileModificationsBySession)
  }

  /** 从待确认列表移除一个文件（确认/回滚成功后）并持久化 */
  function removePendingFile(sessionId: string, path: string): void {
    const list = pendingFileModificationsBySession[sessionId]
    if (!list) return
    const idx = list.findIndex((f) => f.path === path)
    if (idx >= 0) {
      list.splice(idx, 1)
      persistPendingFilesMap(pendingFileModificationsBySession)
    }
  }

  /** 清空指定会话的待确认列表（全部确认/回滚成功后）并持久化 */
  function clearPendingFiles(sessionId: string): void {
    if (pendingFileModificationsBySession[sessionId]) {
      delete pendingFileModificationsBySession[sessionId]
      persistPendingFilesMap(pendingFileModificationsBySession)
    }
  }

  // ---------- 文件变更确认 / 回滚（diffview 面板与对话流联动共用入口） ----------

  /** diff 面板联动焦点：对话流（Write/Edit 名片 / 轮 footer 文件行）跳转面板时
   *  写入目标文件路径，DiffPanel watch 消费（选中并清空）——跨插件定位通道 */
  const diffFocusPath = ref('')

  /**
   * 确认待确认文件（RPC session.confirm_files，files 为路径数组）：
   * daemon 报错整体不动，成功后逐路径移出待确认列表并持久化
   */
  async function confirmSessionFiles(sessionId: string, paths: string[]): Promise<void> {
    if (!sessionId || paths.length === 0) return
    await daemon.call('session.confirm_files', { session_id: sessionId, files: paths })
    for (const p of paths) removePendingFile(sessionId, p)
  }

  /** 回滚待确认文件（RPC session.rollback_files 恢复到修改前内容），成功后移出列表 */
  async function rollbackSessionFiles(sessionId: string, paths: string[]): Promise<void> {
    if (!sessionId || paths.length === 0) return
    await daemon.call('session.rollback_files', { session_id: sessionId, files: paths })
    for (const p of paths) removePendingFile(sessionId, p)
  }

  // ---------- 打开工作目录（跨 Agent 最近活跃会话）----------

  /**
   * 按目录定位最近活跃的一个会话（session.latest_by_dir，桌面「打开工作目录」语义）：
   * 有会话 → 切 Agent 为该会话的 Agent 并切换会话；无会话 → 只清空对话流并
   * 记住目录（供首条消息懒建会话），不自动新建。
   */
  async function openLatestByDir(projectDir: string): Promise<void> {
    const dir = (projectDir || '').replace(/\/+$/, '')
    let info: ServerSessionInfo | null = null
    try {
      info = await daemon.call<ServerSessionInfo | null>('session.latest_by_dir', { project_dir: dir })
    } catch (err) {
      console.warn('[ChatFlow] 按目录查找最近会话失败:', err)
      return
    }

    if (!info?.session_id) {
      clearActiveStream()
      currentProjectDir.value = dir
      return
    }

    if (info.agent_name) currentAgent.value = info.agent_name
    currentProjectDir.value = info.project_dir || dir
    upsertSessionFromServer(info)
    if (info.session_id !== activeSessionId.value) {
      await switchToSession(info.session_id)
    }
    // 刷新全量列表（新目录的其余会话进 Tasks 分组）
    void loadSessions()
  }

  // ---------- 打开文件 / 网页（文件类型接管注册表路由）----------

  /** 剥离 grep 命中行传入的 `:行号`（或 `:起-止`）尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  function extOf(path: string): string {
    const base = path.split('/').pop() || path
    const dot = base.lastIndexOf('.')
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  }

  /**
   * 相对路径候选解析：绝对路径直用；`~/` 前缀换主目录；其余相对路径按
   * 当前会话工作区拼接。逐候选 fs.stat 探测，命中即用；全部落空返回 null。
   */
  async function resolvePath(raw: string): Promise<string | null> {
    const p = raw.trim()
    if (!p) return null
    if (p.startsWith('/')) return p
    const candidates: string[] = []
    if (p.startsWith('~/')) {
      try {
        const home = await daemon.call<{ path: string }>('fs.home')
        candidates.push(`${home.path.replace(/\/+$/, '')}/${p.slice(2)}`)
      } catch {
        // 主目录取不到则跳过该候选
      }
    } else {
      const dir = currentProjectDir.value.replace(/\/+$/, '')
      if (dir) candidates.push(`${dir}/${p}`)
    }
    for (const candidate of candidates) {
      try {
        await daemon.call('fs.stat', { path: candidate })
        return candidate
      } catch {
        // 候选不存在，继续探测
      }
    }
    return null
  }

  /**
   * 按名取详情轨道插件服务（store action 非组件上下文，不能 useService——
   * 此处用 store 初始化捕获的壳本体；对方 store 外壳解引用无 inject 依赖，安全；
   * 服务缺失（插件停用）返回 null 由调用方 toast，不炸）。
   */
  function serviceOf<T>(name: string): T | null {
    try {
      return shell.services.use<T>(name)
    } catch {
      return null
    }
  }

  interface OpenerService {
    readonly store: { open(path: string): Promise<void> | void }
  }

  /**
   * 打开文件到详情轨道：目录 → explorer 定位；接管扩展名 → 声明插件
   * （fileTypes 注册表，市场插件装入即生效）；未接管 → codeeditor 兜底
   * （二进制由其嗅探转系统打开）；codeeditor 缺失 → 系统默认程序 / explorer 定位。
   */
  async function openFile(rawPath: string): Promise<void> {
    const target = stripLineSuffix(rawPath.trim())
    if (!target) return
    const resolved = await resolvePath(target)
    if (!resolved) {
      ElMessage.warning(`文件不存在或不可访问：${target}`)
      return
    }
    let isDir = false
    try {
      const st = await daemon.call<{ is_dir: boolean }>('fs.stat', { path: resolved })
      isDir = st.is_dir
    } catch {
      // 探测失败按文件处理（扩展名路由兜底）
    }
    const ext = extOf(resolved)
    // 文件类型接管注册表路由：扩展名 → 声明插件服务
    if (!isDir) {
      const serviceId = shell.fileTypes.serviceOf(ext)
      if (serviceId) {
        const svc = serviceOf<OpenerService>(serviceId)
        if (svc) {
          await svc.store.open(resolved)
          return
        }
        ElMessage.warning(`.${ext} 文件的查看器未启用`)
        return
      }
      // 未接管扩展名 → codeeditor 兜底（二进制由其嗅探后转系统默认程序）
      const code = serviceOf<OpenerService>('codeeditor.store')
      if (code) {
        await code.store.open(resolved)
        return
      }
    }
    // 未知类型兜底（Agent-Driven UI：file_open 覆盖链 = 内置查看器 → 系统默认
    // 程序）：无内置查看器/编辑器的文件类型（pdf/office/压缩包等）交系统默认
    // 程序打开；无宿主桥（纯 Web）落文件浏览器原兜底
    if (!isDir && window.mxDesktop?.openPath) {
      const errMsg = await window.mxDesktop.openPath(resolved)
      if (errMsg) ElMessage.warning('系统打开失败: ' + errMsg)
      return
    }
    const svc = serviceOf<OpenerService>('explorer.store')
    if (svc) {
      await svc.store.open(resolved)
      return
    }
    ElMessage.warning('文件浏览器未启用')
  }

  /** 打开网页到 web-viewer（同 URL 已开则聚焦；服务缺失 toast 不炸） */
  function openUrl(rawUrl: string): void {
    const url = rawUrl.trim()
    if (!url) return
    const svc = serviceOf<{ readonly store: { open(url: string): void } }>('web-viewer.store')
    if (svc) {
      svc.store.open(url)
      return
    }
    ElMessage.warning('网页查看器未启用')
  }

  return {
    // 会话列表
    sessions,
    sessionsLoading,
    sessionsLoaded,
    currentAgent,
    currentProjectDir,
    workspaces,
    chooseWorkspace,
    loadSessions,
    openLatestByDir,
    // 文件 / 网页打开路由
    openFile,
    openUrl,
    // 活动会话与消息流
    activeSessionId,
    activeSession,
    activeMessages,
    messagesBySession,
    sessionCurrentAgentName,
    markSessionLoaded,
    rounds,
    roundInputs,
    subagentStreams,
    persistedSubtasksFor,
    hasLoaded: (sessionId: string) => loadedSessions.has(sessionId),
    unloadSession,
    switchToSession,
    clearActiveStream,
    // ---------- 处理状态 ----------
    busySessions,
    isProcessing,
    isQueued,
    /** daemon 连接可用（输入区/交互区禁用判定；connection 服务 state 响应式穿透） */
    isConnected,
    isRestoringSession,
    sessionRevealPending,
    isCompacting,
    lastError,
    sessionLoopEnded,
    isBusy,
    unreadBySession,
    // 发送 / 停止 / 重试 / 回退 / 改名
    sendMessage,
    stopProcessing,
    retryFromError,
    deleteRound,
    renameSession,
    deleteSession,
    // 图片与输入辅助
    uploadImageToSessionTmp,
    loadImageAsDataUrl,
    optimizeText,
    removeFile,
    dismissMessage,
    // 上下文 / 文件审查
    contextUsage,
    fetchContextUsage,
    pendingFileModificationsBySession,
    removePendingFile,
    clearPendingFiles,
    confirmSessionFiles,
    rollbackSessionFiles,
    diffFocusPath,
    // 模型列表与切换
    models,
    rawProviders,
    providerTitleMap,
    currentModelName,
    currentModelProvider,
    fetchModels,
    fetchProviders,
    refreshModelCatalog,
    formatProviderTitle,
    initModels,
    switchModel,
    // 阻塞交互
    pendingPermissionToolName,
    grantPermission,
    denyPermission,
    answerSubagentAsk,
  }
})

// ── 服务外壳（契约 §10：provide 的是 Pinia store 响应式本体）─────────────────
// 本 store 带 inject 依赖（daemon/壳捕获），首次实例化必须由组件 setup 触发；
// 装配期 Pinia 尚未安装（mountVueApp 内才 createPinia），故 provide 延迟外壳，
// 消费方（explorer DetailPanel 等组件上下文）首次解引用 .store 时才创建。

export type ChatflowStore = ReturnType<typeof useChatflowStore>

// ── 输入框外部追加入口（explorer「添加到对话」跨插件通道）────────────────────
// ChatFlowPage 挂载时登记 ChatInput 的 appendFileRef（defineExpose），服务壳转发；
// 未登记（对话页未挂载）时 appendFileRef 返回 false，由调用方提示。

/** 外部追加的文件引用（chip 数据：路径 + 目录标记） */
export interface FileRefInput {
  /** 完整绝对路径 */
  path: string
  /** 是否目录（决定引用 chip 的文件夹/文件图标） */
  isDir?: boolean
}

type AppendFileRefHandler = (ref: FileRefInput) => void

let appendFileRefHandler: AppendFileRefHandler | null = null

/** ChatFlowPage 挂载期登记输入框追加函数，卸载时注销（传 null） */
export function registerAppendFileRefHandler(fn: AppendFileRefHandler | null): void {
  appendFileRefHandler = fn
}

export interface ChatflowService {
  /** store 响应式本体（Pinia 缓存实例，重复解引用同一份） */
  readonly store: ChatflowStore
  /** 追加文件引用 chip 进输入框（explorer「添加到对话」）；对话页未挂载返回 false */
  appendFileRef(ref: FileRefInput): boolean
}

export function createChatflowService(): ChatflowService {
  return {
    get store() {
      return useChatflowStore()
    },
    appendFileRef(ref) {
      if (!appendFileRefHandler) return false
      appendFileRefHandler(ref)
      return true
    },
  }
}
