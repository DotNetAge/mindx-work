/**
 * useBlockers：阻塞交互装配派生（desktop ChatArea.vue L232-344 平移，p4-5）。
 *
 * AskUser 与 AskPermission 在 agent 侧均为同步阻塞原语：任一执行时整个 ReAct loop
 * 即时挂起，直到用户响应才继续，因此任意时刻至多存在一个等待中的阻塞请求。
 * 关键：阻塞请求写入「发起会话自己的消息流」——子会话（SubAgent）的阻塞不在 active
 * 会话的消息流里，若不跨会话扫描，用户在主会话将毫无感知、后端永久挂起
 * （「无故停止」根因）。故这里扫描全部会话流尾，active 阻塞直接交互，非 active
 * （子会话）阻塞：提问冒泡主界面直接作答（answerSubagentAsk 路由）、授权弹
 * 「提示 + 跳转」卡。
 *
 * 宿主（ChatFlowPage，p4-6 装配）消费面：activeBlocker / remoteBlocker /
 * blockerPermissionData / permissionBlockerRevoked / remoteBlockedMeta /
 * handlePermissionGrant / handlePermissionDeny / handleSubagentAskSubmitted /
 * jumpToBlockedSession。
 */
import { computed, reactive } from 'vue'
import type { ChatMessage } from '../model/message'
import { useChatflowStore } from '../store'

interface BlockedInfo {
  sessionId: string
  kind: 'ask' | 'permission'
  message: ChatMessage
  isActive: boolean
}

export function useBlockers() {
  const store = useChatflowStore()

  // 已响应的阻塞请求消息 id：授权/拒绝后立即收起 Drawer，不等后端产出新消息
  // （否则阻塞消息仍留在流里，确认组件会持续遮挡输入区直到工具执行完）
  const respondedBlockerIds = reactive(new Set<string>())

  const blockedSessions = computed<BlockedInfo[]>(() => {
    const active = store.activeSessionId
    const list: BlockedInfo[] = []
    for (const [sid, msgs] of Object.entries(store.messagesBySession)) {
      if (!msgs.length) continue
      // 从尾向前找最后一条阻塞请求（form / permission_request）。
      // 阻塞请求之后可能跟随过程性消息（如 task_summary「等待授权」摘要 —— executor 在
      // PermissionPending 后紧接着发 TaskSummary，thinking_done / 工具占位等），
      // 它们不算「已响应」，不得阻断阻塞判定（否则 AskPermission 的 Drawer 永不弹出）；
      // 只有出现新的 user 消息或最终答案（markdown / final_answer）才算已响应。
      let blocker: ChatMessage | null = null
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if (!m) continue
        if (m.eventType === 'form' || m.eventType === 'permission_request') {
          blocker = m
          break
        }
        if (m.role === 'user' || m.eventType === 'final_answer' || m.eventType === 'markdown') {
          blocker = null
          break
        }
      }
      if (blocker && !respondedBlockerIds.has(blocker.id)) {
        list.push({
          sessionId: sid,
          kind: blocker.eventType === 'form' ? 'ask' : 'permission',
          message: blocker,
          isActive: sid === active
        })
      }
    }
    return list
  })

  // active 会话的阻塞：直接渲染交互组件（AskUserView / PermissionBar）
  const activeBlocker = computed(() => blockedSessions.value.find(b => b.isActive) || null)

  // 非 active 会话（子会话）的阻塞：渲染「提示 + 跳转」；仅在没有 active 阻塞时接管
  const remoteBlocker = computed(() =>
    !activeBlocker.value ? blockedSessions.value.find(b => !b.isActive) || null : null
  )

  /** 跳转到阻塞的子会话（work 无 Tab 模型：Content 单活动视图，直接切会话；
   *  子会话流已有实时数据时先标记已加载，避免服务端旧快照覆盖实时流） */
  async function jumpToBlockedSession(sessionId: string) {
    if (!sessionId || sessionId === store.activeSessionId) return
    if ((store.messagesBySession[sessionId] || []).length > 0) {
      store.markSessionLoaded(sessionId)
    }
    await store.switchToSession(sessionId)
  }

  /** 子会话阻塞提示的展示信息（工具名 / 提问文本 / agent 名）。
   *  sessionCurrentAgentName 为非响应式登记表：值总在消息 push 的同一事件内登记，
   *  blockedSessions 因消息流（reactive）变化重算时读到最新值，行为与 desktop 一致 */
  const remoteBlockedMeta = computed(() => {
    const b = remoteBlocker.value
    if (!b) return null
    const d = b.message.eventData || {}
    const toolName = d.tool_name || d.toolName || ''
    const question = (Array.isArray(d.questions) ? d.questions[0]?.question : '') || d.question || ''
    const agent = store.sessionCurrentAgentName[b.sessionId]
      || d.agent_name
      || b.message.metadata?.agent_name
      || ''
    return { toolName, question, agent }
  })

  /** 子代理提问已在主界面作答：立即标记该请求已响应（Drawer 收起不等回扫） */
  function handleSubagentAskSubmitted(messageId: string) {
    respondedBlockerIds.add(messageId)
  }

  const blockerPermissionData = computed(() => {
    const m = activeBlocker.value?.message
    if (!m || m.eventType !== 'permission_request') return null
    const d = m.eventData || {}
    return {
      toolName: d.tool_name || d.toolName || '',
      reason: d.reason || d.Reason || '',
      securityLevel: String(d.security_level || d.SecurityLevel || 'medium'),
      // 子会话授权冒泡：授权/拒绝时携带发起授权的子会话 ID（与 PermissionBar 原逻辑一致）
      sessionId: d.session_id || ''
    }
  })

  // 授权撤销判定：阻塞请求消息之后出现 permission_denied（新请求覆盖旧挂起 / 会话
  // 回滚作废旧挂起）说明后端已撤销该授权，Drawer 中的过期授权卡片须灰化禁用
  const permissionBlockerRevoked = computed(() => {
    const blocker = activeBlocker.value
    if (!blocker || blocker.kind !== 'permission') return false
    const msgs = store.messagesBySession[blocker.sessionId] || []
    const idx = msgs.findIndex(m => m.id === blocker.message.id)
    if (idx < 0) return false
    return msgs.slice(idx + 1).some(m => m.eventType === 'permission_denied')
  })

  /** 授权同意：先校验工具名兜底（无待授权工具时不得标记已响应——Drawer 收起而后端
   *  永久挂起），再标记已响应立即收起 + store.grantPermission 发魔术词（sponsor 路由在 store 内） */
  function handlePermissionGrant(data: Record<string, any>) {
    const toolName = data?.tool_name || store.pendingPermissionToolName
    if (!toolName) return
    if (activeBlocker.value) respondedBlockerIds.add(activeBlocker.value.message.id)
    store.grantPermission({
      tool_name: data?.tool_name,
      remember: data?.remember === true,
      session_id: data?.session_id
    })
  }

  /** 授权拒绝：payload 兼容 string（纯 reason）与 object（树节点/弹窗冒泡两种形状）。
   *  校验顺序同 handlePermissionGrant：无待授权工具不标记已响应 */
  function handlePermissionDeny(payload?: string | Record<string, any>) {
    const data = typeof payload === 'object' && payload !== null ? payload : {}
    const toolName = (data as { tool_name?: string }).tool_name || store.pendingPermissionToolName
    if (!toolName) return
    if (activeBlocker.value) respondedBlockerIds.add(activeBlocker.value.message.id)
    store.denyPermission({
      tool_name: (data as { tool_name?: string }).tool_name,
      session_id: (data as { session_id?: string }).session_id
    })
  }

  return {
    activeBlocker,
    remoteBlocker,
    blockerPermissionData,
    permissionBlockerRevoked,
    remoteBlockedMeta,
    handlePermissionGrant,
    handlePermissionDeny,
    handleSubagentAskSubmitted,
    jumpToBlockedSession
  }
}
