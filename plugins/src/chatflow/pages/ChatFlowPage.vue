<script setup lang="ts">
/**
 * ChatFlowPage：对话流主页面（四期完整装配，源：mindx-desktop ChatArea.vue 改造收尾）。
 *
 * 数据与装配：
 * - 全量接 useChatflowStore：轮次流（rounds/roundInputs）+ builder 全会话建树（子会话
 *   流 / localStorage 子任务旁路数据源）+ 上下文用量 + 连接/忙碌/恢复/压缩态；
 * - ChatInput：connected/models/busy/placeholder 真数据注入；发送 → store.sendMessage
 *   （无活动会话时 store 内懒创建）；图片落盘 / 输入优化 / 停止执行已在 ChatInput 内
 *   直连 store；
 * - 模型列表与切换：model.list / model.switch（desktop connectionStore 同构），
 *   models 供 NoModel 判定与快速切换下拉（work 无 models 插件 services，直走 daemon
 *   RPC——desktop fetchModels/switchModel 逐行实证，非猜测协议）；
 * - Agent 描述占位：消费 agents.registry 服务（插件间禁止 import，消费侧本地声明形状，
 *   先例同 TasksSection）；
 * - 阻塞交互 Drawer（useBlockers + AskUserView / PermissionBar）：active 阻塞直接
 *   交互；子会话阻塞提问冒泡主界面直接作答（answerSubagentAsk 路由）/ 授权「提示 +
 *   跳转」；自下而上滑出遮挡 ChatInput，确保任何阻塞都无法被用户无视；
 * - 骨架屏（isRestoringSession 覆盖，消息流在背后渲染）+ 揭晓 watch（1.5s 兜底 +
 *   nextTick + rAF 滚底后移除，desktop ChatArea 同构）+ 压缩覆盖层（isCompacting）；
 * - 渐进式加载渲染窗（概念框架 §4.4 定稿）：见下方渲染窗注释。
 *
 * 两种会话形态（概念框架 §7）：
 * - 空会话（无恢复且活动会话无消息）→ hero 形态（HeroTitle + ChatInput 居中）；
 * - 有轮次 → 消息流 + 底部输入（desktop ChatArea 布局对齐）。
 *
 * fixture 回归通道保留：?fixture=rounds（二期四轮静态流 + 假发送）/ slot（五期槽位
 * 渲染出口 + 假发送）/ nomodel / disabled（输入区三态）。样式：全量 --mx-* 语义 token（军规 3），desktop token
 * 按移植计划附录 A 映射。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { buildTreesForRounds, clearTreeBuildState } from '../tree/builder'
import type { RoundTree } from '../tree/builder'
import {
  buildFixtureRounds,
  buildSlotFixtureRounds,
  fixtureContextUsage,
  fixtureSessionId,
  fixtureSubagentStreams,
} from '../fixture/session'
import { resolveInputFixtureState } from '../fixture/inputStates'
import type { ChatMessage, ChatRound } from '../model/message'
import ChatRoundView from '../chatround/index.vue'
import ChatInput from '../input/index.vue'
import HeroTitle from '../input/HeroTitle.vue'
import SkeletonChat from '../content/SkeletonChat.vue'
import TurnRail from '../content/TurnRail.vue'
import AskUserView from '../content/BottomBar/AskUserView.vue'
import PermissionBar from '../content/BottomBar/PermissionBar.vue'
import { registerAppendFileRefHandler, useChatflowStore } from '../store'
import type { ModelInfo, ProviderInfo } from '../store'
import { useBlockers } from '../content/useBlockers'

const store = useChatflowStore()
// ChatInput 外部填入通道（undo 回退回填等，defineExpose fillText / fillAndSend）
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)
// 「添加到对话」跨插件通道：登记 ChatInput 的引用 chip 追加函数（explorer 经
// chatflow.store 服务转发；hero/消息流两形态共用同一 ref，运行期解引用），
// 卸载注销防悬挂闭包
registerAppendFileRefHandler((ref) => chatInputRef.value?.appendFileRef(ref))
onBeforeUnmount(() => registerAppendFileRefHandler(null))
// 轮次指示器当前轮联动的 rAF 句柄清理
onBeforeUnmount(() => {
  if (activeRafId) cancelAnimationFrame(activeRafId)
})
const {
  activeBlocker,
  remoteBlocker,
  blockerPermissionData,
  permissionBlockerRevoked,
  remoteBlockedMeta,
  handlePermissionGrant,
  handlePermissionDeny,
  handleSubagentAskSubmitted,
  jumpToBlockedSession,
} = useBlockers()

// ── fixture 回归通道（?fixture=rounds / slot / nomodel / disabled；缺省真数据态）──
const fixtureName = new URLSearchParams(window.location.search).get('fixture') || ''
const isRoundsFixture = fixtureName === 'rounds'
// 五期槽位 fixture：动态装载扩展（模块顶层 register = 装配期）后供单轮静态流
const isSlotFixture = fixtureName === 'slot'
const isFixture = isRoundsFixture || isSlotFixture
// 输入区三态 fixture：nomodel / disabled 覆盖连接与模型真数据（验收通道）
const inputFixture =
  fixtureName === 'nomodel' || fixtureName === 'disabled'
    ? resolveInputFixtureState(window.location.search)
    : null

// ── 连接 / 模型（fixture 覆盖或 store 真数据）────────────────────────────
// fixture 覆盖：nomodel / disabled 走三态打桩；rounds / slot 固定「已连接 + 有模型」，
// 回归不依赖 daemon 环境状态（daemon 已连但 models 为空时 NoModel 会整块替换输入区）
const connected = computed(() => {
  if (inputFixture) return inputFixture.connected
  if (isFixture) return true
  return store.isConnected
})
// rounds / slot fixture 的静态模型数据（单供应商单模型，供下拉分组渲染回归）
const FIXTURE_MODELS: ModelInfo[] = [
  { name: 'fixture-model', title: 'fixture-model', provider: 'fixture', enabled: true },
]
const FIXTURE_PROVIDERS: ProviderInfo[] = [
  { name: 'fixture', title: 'Fixture', api_key: true, base_url: 'http://localhost' },
]
const models = computed<ModelInfo[]>(() => {
  if (inputFixture) return inputFixture.models
  if (isFixture) return FIXTURE_MODELS
  return store.models
})
const rawProviders = computed<ProviderInfo[]>(() => {
  if (inputFixture) return inputFixture.rawProviders
  if (isFixture) return FIXTURE_PROVIDERS
  return store.rawProviders
})
const providerTitles = computed<Record<string, string>>(() => {
  if (inputFixture || isFixture) {
    return Object.fromEntries(rawProviders.value.filter((p) => p.title).map((p) => [p.name, p.title as string]))
  }
  return store.providerTitleMap
})
// 当前模型：以服务端配置为权威（store.currentModelName，resolveCurrentModel 初始化 +
// switchModel 成功后更新）；fixture 态本地 echo。显示回落语义在 ModelSelector 内
// （desktop ModelSelector.currentModel 同构：列表外才回落首个可用模型）。
const fixtureSelectedModelName = ref(inputFixture?.currentModel || '')
const currentModelName = computed(() =>
  inputFixture ? fixtureSelectedModelName.value : store.currentModelName
)
const currentModelProvider = computed(() => {
  if (inputFixture) {
    return inputFixture.models.find((m) => m.name === fixtureSelectedModelName.value)?.provider || ''
  }
  return store.currentModelProvider
})

// 模型快速切换：model.switch {name, provider}（desktop ModelSelector.onSelectModel 同构，
// 组合键唯一定位）；成功后 store 内更新当前模型，失败提示回弹
async function handleModelSelect(model: ModelInfo) {
  if (inputFixture) {
    // fixture 态无 daemon：本地 echo（三期通道）
    fixtureSelectedModelName.value = model.name
    return
  }
  try {
    await store.switchModel(model.name, model.provider)
  } catch (err) {
    console.error('[ChatFlowPage] 切换模型失败:', err)
    ElMessage.error(`切换模型失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── Agent 描述占位（desktop connectionStore.currentAgent.description 同语义）──
interface AgentsRegistry {
  list(): Promise<
    Array<{ name: string; description?: string; role?: string; nick_name?: string; icon?: string }>
  >
}
const agentsRegistry = useService<AgentsRegistry>('agents.registry')
const agentDescriptionByName = ref<Record<string, string>>({})
const inputPlaceholder = computed(() => {
  const name = store.activeSession?.agent_name || store.currentAgent
  return (name && agentDescriptionByName.value[name]) || ''
})

// ── 初始拉取：连接建立时机（desktop ActivityPane L172-184 同构）──────────
// 组件挂载早于 ws 建连，onMounted 直拉必然 reject（daemon.call 未 OPEN 直接拒绝）；
// 已连接立即执行（晚挂载场景），状态跃迁 connected 时执行（重连再次触发同语义）
function fetchInitialData(): void {
  if (isFixture) return
  void store.initModels()
  agentsRegistry
    .list()
    .then((list) => {
      const map: Record<string, string> = {}
      const identities = new Map<string, AgentIdentity>()
      for (const a of list || []) {
        if (a.name && a.description) map[a.name] = a.description
        identities.set(a.name, { name: a.name, nickName: a.nick_name, role: a.role, icon: a.icon })
      }
      agentDescriptionByName.value = map
      agentIdentityMap.value = identities
    })
    .catch((err) => console.warn('[ChatFlowPage] Agent 清单拉取失败:', err))
}
if (store.isConnected) fetchInitialData()
watch(
  () => store.isConnected,
  (connected) => {
    if (connected) fetchInitialData()
  },
)

// ── 轮次与建树 ─────────────────────────────────────────────────────────────
// fixture：二期四轮静态流（回归底座，builder 建树照常走 fixtureSessionId）
const fixtureRounds = ref<ChatRound[]>(isRoundsFixture ? buildFixtureRounds() : [])
if (isRoundsFixture) clearTreeBuildState(fixtureSessionId)
// 五期槽位 fixture：先动态装载扩展（模块顶层 register，贡献层就位），再供轮数据建树
// （装载层防线：扩展不入壳插件循环，仅 fixture 通道动态装载，生产装配不含本模块）
if (isSlotFixture) {
  clearTreeBuildState(fixtureSessionId)
  void import('../fixture/slotExtension')
    .then(() => {
      fixtureRounds.value = buildSlotFixtureRounds()
    })
    .catch((err: unknown) => console.error('[ChatFlowPage] 槽位扩展装载失败（装配失败）:', err))
}
// 子会话流引用保持稳定（builder 按 subagent 键记忆化，重建 pass 传同引用保证缓存命中）
const fixtureSubStreams = isRoundsFixture ? fixtureSubagentStreams() : undefined
const fixtureRoundItems = computed(() => {
  const trees = buildTreesForRounds(
    fixtureSessionId,
    fixtureRounds.value.map((r) => ({
      key: r.key,
      messages: r.messages,
      isFinal: r.hasFinalAnswer,
    })),
    fixtureSubStreams ? { subagentStreams: fixtureSubStreams } : undefined
  )
  return fixtureRounds.value.map((round, i) => ({ round, tree: trees[i] ?? null }))
})

// 真数据建树（desktop ChatArea roundTrees 同构：builder 按轮记忆化，历史轮消息数
// 未变则复用缓存；isFinal 口径已在 store.roundInputs 内对齐 desktop）
const roundTrees = computed<Map<string, RoundTree>>(() => {
  const sid = store.activeSessionId
  if (!sid || store.roundInputs.length === 0) return new Map()
  const trees = buildTreesForRounds(sid, store.roundInputs, {
    persistedSubtasks: store.persistedSubtasksFor(sid),
    subagentStreams: store.subagentStreams,
  })
  return new Map(trees.map((t) => [t.roundKey, t]))
})

const liveRoundItems = computed(() =>
  store.rounds.map((round) => ({ round, tree: roundTrees.value.get(round.key) ?? null }))
)

const roundItems = computed(() => (isFixture ? fixtureRoundItems.value : liveRoundItems.value))

// ── 轮次指示器（左侧波浪刻度尺）：全量轮次 + 当前轮联动 + 点击跳转 ──────────
// 刻度绑定全量轮次（渲染窗只裁剪 DOM，数据恒在内存）；点击窗口外的旧轮先扩窗
// 再滚动定位（扩一页余量，transition-group 入场动画期间二次 rAF 等布局就位）
const roundsRail = computed(() =>
  roundItems.value.map((item, i) => ({
    key: item.round.key,
    title:
      item.round.userMessage?.content?.replace(/\s+/g, ' ').trim().slice(0, 60) ||
      item.round.messages[0]?.content?.replace(/\s+/g, ' ').trim().slice(0, 60) ||
      `第 ${i + 1} 轮`,
  }))
)

const activeRailIndex = ref(-1)
let activeRafId = 0

/** 当前轮联动：视口 40% 线落在哪一轮（滚动高频，rAF 合并只保留最后一次） */
function scheduleActiveRoundUpdate() {
  if (activeRafId) return
  activeRafId = requestAnimationFrame(() => {
    activeRafId = 0
    const el = chatContainer.value
    if (!el) return
    const nodes = el.querySelectorAll<HTMLElement>('[data-round-key]')
    const mid = el.getBoundingClientRect().top + el.clientHeight * 0.4
    let currentKey = ''
    nodes.forEach((node) => {
      if (node.getBoundingClientRect().top <= mid) currentKey = node.dataset.roundKey || ''
    })
    activeRailIndex.value = currentKey
      ? roundsRail.value.findIndex((r) => r.key === currentKey)
      : -1
  })
}

function handleRoundSelect(key: string) {
  const idx = roundItems.value.findIndex((r) => r.round.key === key)
  if (idx < 0) return
  const need = roundItems.value.length - idx
  if (!isFixture && renderWindowEnd.value < need) {
    renderWindowEnd.value = Math.min(roundItems.value.length, need + RENDER_PAGE)
  }
  nextTick(() => {
    requestAnimationFrame(() => {
      chatContainer.value
        ?.querySelector<HTMLElement>(`[data-round-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
}

// ── 渐进式加载渲染窗（概念框架 §4.4 定稿）───────────────────────────────────
// 数据全量在内存（store 恢复即全量），窗口只裁剪渲染：进入已有会话首屏渲染最近
// RENDER_PAGE 轮，向上滚动触顶按 RENDER_PAGE 一页向上扩窗（无数据加载）；实时对话
// 窗口达到 LIVE_CAP 轮后新轮入窗、最旧轮自动滑出 DOM（用户无感，界面不爆炸）。
// 游标压缩折叠占位（----历史消息已压缩----，其前消息折叠不清链）：渲染机制就位、
// 数据源挂起——依赖 Daemon 游标大修（禁猜协议），就位后在窗口上界渲染占位分隔符，
// 与本渲染窗天然兼容（窗口上界即折叠位）。
const RENDER_PAGE = 3
const LIVE_CAP = 10
const renderWindowEnd = ref(RENDER_PAGE)

const visibleRoundItems = computed(() => {
  if (isFixture) return roundItems.value
  return roundItems.value.slice(-renderWindowEnd.value)
})

// 实时新轮入窗：窗口 < LIVE_CAP 时跟随增长（新会话从 0 渐涨全程可见）；
// 达到 LIVE_CAP 后钉住（slice(-N) 头部自动前推 = 最旧轮移除 DOM）
watch(
  () => store.rounds.length,
  (len, prev) => {
    if (isFixture || len <= (prev ?? 0)) return
    if (renderWindowEnd.value < LIVE_CAP) {
      renderWindowEnd.value = Math.min(renderWindowEnd.value + 1, LIVE_CAP)
    }
  }
)

// ── 滚动（desktop ChatArea 同构 + 渲染窗触顶扩窗）──────────────────────────
const chatContainer = ref<HTMLElement | null>(null)

function scrollToBottom() {
  const el = chatContainer.value
  if (el) el.scrollTop = el.scrollHeight
}

// 新消息 / 流式增量滚底（desktop ChatArea 同构：长度与内容双 watch）
watch(
  () => store.activeMessages.length,
  () => nextTick(() => scrollToBottom())
)
watch(
  () => store.activeMessages.map((m) => m.content).join(''),
  () => nextTick(() => scrollToBottom()),
  { flush: 'post' }
)

// 向上滚动触顶：向上扩一页，扩窗后补偿滚动位置保持视觉稳定（纯渲染裁剪）
function handleStreamScroll() {
  // 轮次指示器当前轮联动（fixture 与真数据同语义）
  scheduleActiveRoundUpdate()
  if (isFixture) return
  const el = chatContainer.value
  if (!el || el.scrollTop > 40) return
  if (renderWindowEnd.value >= store.rounds.length) return
  const prevHeight = el.scrollHeight
  const prevTop = el.scrollTop
  renderWindowEnd.value += RENDER_PAGE
  nextTick(() => {
    const grown = chatContainer.value
    if (grown) grown.scrollTop = grown.scrollHeight - prevHeight + prevTop
  })
}

// 切换会话：渲染窗重置首屏 + 滚底（已加载会话走内存分支不弹骨架屏，需在此滚底）
watch(
  () => store.activeSessionId,
  () => {
    renderWindowEnd.value = RENDER_PAGE
    nextTick(() => {
      scrollToBottom()
      // 首屏滚底后立即联动当前轮（内容不满一屏无 scroll 事件时的兜底）
      scheduleActiveRoundUpdate()
    })
  }
)

// ── 切换会话骨架屏揭晓（desktop ChatArea 同构）──────────────────────────────
watch(
  () => store.sessionRevealPending,
  (pending) => {
    if (!pending) return
    // 兜底：揭晓（nextTick + rAF）失败时 1.5s 后强制结束恢复态，防止
    // sessionRevealPending / isRestoringSession 永久卡 true（会话「消失」根因）
    const timer = setTimeout(() => {
      if (store.isRestoringSession) {
        store.isRestoringSession = false
        store.sessionRevealPending = false
      }
    }, 1500)
    nextTick(() => {
      // 临时禁用平滑滚动，确保瞬间到位
      const el = chatContainer.value
      if (el) {
        el.style.scrollBehavior = 'auto'
        scrollToBottom()
        // 确保滚动提交到浏览器的渲染管线后再揭晓
        requestAnimationFrame(() => {
          clearTimeout(timer)
          store.isRestoringSession = false
          store.sessionRevealPending = false
          el.style.scrollBehavior = ''
        })
      }
    })
  }
)

// ── 展示态派生 ─────────────────────────────────────────────────────────────
// 会话形态：恢复中 / 活动会话有消息 → 消息流形态；否则 hero（空会话大输入卡）。
// 恢复中排除 hero：骨架屏只覆盖消息流，hero 闪现会造成形态抖动。
const showHero = computed(
  () => !isFixture && !store.isRestoringSession && store.rounds.length === 0
)

// 执行 agent 显示名（desktop ChatRound 同构：sessionCurrentAgentName 优先，回落 'Agent'）。
// 读消息流长度建立响应式依赖（sessionCurrentAgentName 为非响应式登记表，值总在消息
// push 的同一事件内登记——useBlockers.remoteBlockedMeta 同语义）
const agentLabel = computed(() => {
  void store.activeMessages.length
  const sid = store.activeSessionId
  return (sid && store.sessionCurrentAgentName[sid]) || 'Agent'
})

/**
 * 轮头 Agent 身份（头像 + 昵称 + role）：agentsRegistry 建 name 索引，
 * 显示规则与侧栏 Agent 切换器一致（昵称主名 + role 小字，头像 icon 优先、
 * 首字兜底）。拉取并入上方 fetchInitialData（挂载早于 ws 建连，onMounted
 * 直拉必然 reject，isConnected 跃迁时重试——与 Agent 描述同路径）。
 */
interface AgentIdentity {
  name: string
  nickName?: string
  role?: string
  icon?: string
}

const agentIdentityMap = ref<Map<string, AgentIdentity>>(new Map())

const agentIdentity = computed<AgentIdentity | undefined>(() => {
  void store.activeMessages.length // 与 agentLabel 同源：读消息流建立响应式依赖
  const sid = store.activeSessionId
  const name = (sid && store.sessionCurrentAgentName[sid]) || ''
  return name ? agentIdentityMap.value.get(name) : undefined
})

// 会话忙碌（发送 ⇄ 停止；desktop chatStore.isBusy(activeSessionId) 同语义，
// 全部轮统一传入——desktop ChatRound 内部按会话查询，行为一致）
const busy = computed(() => store.isBusy(store.activeSessionId || undefined))

// 显示态用量：活动会话用 session.context 实测（store.contextUsage，仅活动会话）；
// hero 空会话时 session 尚未创建（session_id 为空，session.context 无法调用），
// 以当前模型 context_length 构造零值，保证指示器常驻输入区（用户要求）。
// 模型未配置（NoModel）时仍为 null 不渲染。
const contextUsage = computed(() => {
  if (isRoundsFixture) return fixtureContextUsage
  if (store.contextUsage) return store.contextUsage
  const model = store.models.find(
    (m) => m.name === store.currentModelName && m.provider === store.currentModelProvider,
  )
  const maxWindow = model?.context_length
  if (!maxWindow || maxWindow <= 0) return null
  return {
    window_tokens: 0,
    max_window_size: maxWindow,
    usage_ratio: 0,
    message_count: 0,
    cursor: 0,
    active_message_count: 0,
    total_actual_tokens: 0,
    total_cost: 0,
  }
})

// ── 发送 ───────────────────────────────────────────────────────────────────
// 真数据：store.sendMessage（无活动会话时 store 内懒创建）；fixture 轮静态流走假发送
async function handleSend(payload: {
  text: string
  images: Array<{ path: string; media_type: string }>
}) {
  // 发送失败反馈（desktop ChatInput 发送守卫链同构：notConnected / noAgent /
  // cannotCreateSession 的提示语义；work 守卫收敛在 store，宿主消费 sent + lastError）
  const result = await store.sendMessage(payload.text, payload.images)
  if (!result.sent) {
    ElMessage.error(store.lastError || '消息发送失败')
  }
  nextTick(() => scrollToBottom())
}

// ── 工作区选择器（hero 新会话态专属；图 2 定稿交互）──────────────────────
// hero 形态 ChatInput 常驻 show-workspace；会话形态不渲染（clearActiveStream
// 后必走 hero 分支，chip 随 hero 消失）。选中/添加经 openLatestByDir 一步就位。

// 选中历史工作区：有会话切该目录最近会话，无会话记住目录供懒建
async function handleSelectWorkspace(dir: string): Promise<void> {
  await store.openLatestByDir(dir)
  nextTick(() => scrollToBottom())
}

// 添加工作区：daemon fs.choose_dir 弹系统级目录选择对话框；取消（null）静默，
// 失败（lastError 已写）弹真实原因
async function handleAddWorkspace(): Promise<void> {
  const dir = await store.chooseWorkspace()
  if (!dir && store.lastError) ElMessage.error(store.lastError)
}

// fixture 假发送打桩（回归通道）：user 轮 + 本地回执追加进 fixture 轮流
let liveSeq = 0
function handleFakeSend(payload: {
  text: string
  images: Array<{ path: string; media_type: string }>
}) {
  liveSeq += 1
  const timestamp = new Date().toISOString()
  const userMessage: ChatMessage = {
    id: `live-u${liveSeq}`,
    role: 'user',
    content: payload.text,
    timestamp,
    sessionId: fixtureSessionId,
    ...(payload.images.length > 0 ? { images: payload.images } : {}),
  }
  const answer: ChatMessage = {
    id: `live-a${liveSeq}`,
    role: 'assistant',
    content: `已收到：「${payload.text}」\n\n会话数据层随四期接入，当前为本地打桩回复。`,
    timestamp,
    eventType: 'content_delta',
    metadata: { finish_reason: 'stop' },
    sessionId: fixtureSessionId,
  }
  fixtureRounds.value.push({
    key: userMessage.id,
    userMessage,
    messages: [userMessage, answer],
    hasFinalAnswer: true,
  })
}

function onSend(payload: { text: string; images: Array<{ path: string; media_type: string }> }) {
  if (isFixture) handleFakeSend(payload)
  else void handleSend(payload)
}

// ── 轮内事件（desktop ChatArea 同构）───────────────────────────────────────
function handleRetry(messageId: string) {
  void store.retryFromError(messageId)
}

function handleDismiss(messageId: string) {
  const sid = store.activeSessionId
  if (!sid) return
  store.dismissMessage(sid, messageId)
}

async function handleUndoRound(messageId: number, restoreContent?: string) {
  const sid = store.activeSessionId
  if (!sid || !messageId) return
  // 回退模式：回收前先把用户消息回填到输入框，便于编辑后重发
  if (restoreContent) chatInputRef.value?.fillText(restoreContent)
  const ok = await store.deleteRound(sid, messageId)
  if (!ok) return
  // 重新加载会话消息与上下文用量（deleteRound 已同步本地视图；已加载会话
  // switchToSession 走内存分支不重拉服务端）
  await store.switchToSession(sid)
  void store.fetchContextUsage(sid)
}

// 壳单例：Settings 面板通道（供应商配置管理入口）
const shell = useShell()

// 打开模型设置：激活 models 插件注册的「模型」设置页（page id 'models'，见
// plugins/src/models/index.ts）——ModelSelector 底部按钮 / NoModel 引导 /
// ErrorView 402 提示按钮共用此通道。插件可被停用，未注册时保留提示不硬崩。
function handleOpenModelSettings() {
  if (shell.Settings.hasPage('models')) {
    shell.Settings.setActivePage('models')
    shell.Settings.open()
  } else {
    ElMessage.info('模型管理页未注册（models 插件未启用）')
  }
}
</script>

<template>
  <div :class="$style.page">
    <!-- 空会话：hero 形态（hero 标题 + 大输入卡，居中 Content 中部） -->
    <div v-if="showHero" :class="$style.hero">
      <HeroTitle />
      <div :class="$style.heroInput">
        <ChatInput
          ref="chatInputRef"
          :connected="connected"
          :models="models"
          :raw-providers="rawProviders"
          :provider-titles="providerTitles"
          :current-model-name="currentModelName"
          :current-model-provider="currentModelProvider"
          :context-usage="contextUsage"
          :busy="busy"
          :placeholder="inputPlaceholder"
          :show-workspace="true"
          :workspaces="store.workspaces"
          :current-dir="store.currentProjectDir"
          @send="onSend"
          @model-select="handleModelSelect"
          @open-model-settings="handleOpenModelSettings"
          @refresh-models="store.refreshModelCatalog()"
          @select-workspace="handleSelectWorkspace"
          @add-workspace="handleAddWorkspace"
        />
      </div>
    </div>

    <!-- 有轮次：消息流 + 底部输入（desktop ChatArea 布局对齐） -->
    <template v-else>
      <div :class="$style.streamWrap">
        <!-- 轮次指示器：左侧波浪刻度尺（全量轮次；hover 波浪 + tooltip，点击跳轮） -->
        <TurnRail
          v-if="!store.isCompacting"
          :rounds="roundsRail"
          :active-index="activeRailIndex"
          @select="handleRoundSelect"
        />
        <!-- 消息流：与骨架屏共存，恢复时隐藏在骨架屏后方；压缩中整块隐藏 -->
        <div
          v-if="!store.isCompacting"
          ref="chatContainer"
          :class="$style.stream"
          @scroll="handleStreamScroll"
        >
          <transition-group name="message-list" tag="div" :class="$style.roundsList">
            <div
              v-for="item in visibleRoundItems"
              :key="item.round.key"
              :data-round-key="item.round.key"
              :class="$style.roundWrapper"
            >
              <ChatRoundView
                :round="item.round"
                :round-tree="item.tree"
                :agent-label="agentLabel"
                :agent-identity="agentIdentity"
                :round-executing="busy"
                @permission-grant="(data) => handlePermissionGrant(data)"
                @permission-deny="(reason) => handlePermissionDeny(reason)"
                @retry="handleRetry"
                @dismiss="handleDismiss"
                @undo-round="handleUndoRound"
                @open-settings="handleOpenModelSettings"
              />
            </div>
          </transition-group>
        </div>

        <!-- 切换会话加载历史消息时的骨架屏覆盖层 -->
        <div v-if="store.isRestoringSession" :class="$style.skeletonOverlay">
          <SkeletonChat />
        </div>

        <!-- 压缩对话时的覆盖层 -->
        <div v-if="store.isCompacting" :class="$style.compactOverlay">
          <div :class="$style.compactSpinner"></div>
          <div :class="$style.compactLabel">正在整理对话</div>
        </div>
      </div>

      <ChatInput
        ref="chatInputRef"
        :connected="connected"
        :models="models"
        :raw-providers="rawProviders"
        :provider-titles="providerTitles"
        :current-model-name="currentModelName"
        :current-model-provider="currentModelProvider"
        :context-usage="contextUsage"
        :busy="busy"
        :placeholder="inputPlaceholder"
        @send="onSend"
        @model-select="handleModelSelect"
        @open-model-settings="handleOpenModelSettings"
        @refresh-models="store.refreshModelCatalog()"
      />

      <!-- 阻塞交互 Drawer：active 阻塞直接交互；子会话阻塞弹「提示 + 跳转」，
           自下而上出现遮挡 ChatInput，确保任何阻塞都无法被用户无视（desktop 同构） -->
      <transition name="drawer-up">
        <div v-if="activeBlocker || remoteBlocker" :class="$style.blockerDrawer" @click.stop>
          <div :class="$style.blockerDrawerInner">
            <!-- active 会话阻塞：直接交互 -->
            <template v-if="activeBlocker">
              <AskUserView
                v-if="activeBlocker.kind === 'ask'"
                :form-data="activeBlocker.message.eventData || {}"
              />
              <PermissionBar
                v-else-if="blockerPermissionData"
                v-bind="blockerPermissionData"
                :disabled="permissionBlockerRevoked"
                @grant="(data) => handlePermissionGrant(data)"
                @deny="(reason) => handlePermissionDeny(reason)"
              />
            </template>

            <!-- 非 active 子会话阻塞：子代理提问冒泡主界面直接作答（不跳转，作答经
                 answerSubagentAsk 路由到子会话）；授权仍为「提示 + 跳转」，
                 避免后端永久挂起（系统「无故停止」） -->
            <div v-else-if="remoteBlocker" :class="$style.blockerRemoteWrap">
              <template v-if="remoteBlocker.kind === 'ask'">
                <div :class="$style.blockerAskAgent">
                  <template v-if="remoteBlockedMeta?.agent">
                    {{ remoteBlockedMeta.agent }} ·
                  </template>
                  子代理向你提问
                </div>
                <AskUserView
                  :form-data="remoteBlocker.message.eventData || {}"
                  :target-session-id="remoteBlocker.sessionId"
                  @submitted="handleSubagentAskSubmitted(remoteBlocker.message.id)"
                />
              </template>
              <div v-else :class="$style.blockerRemote">
                <div :class="$style.blockerRemoteIcon">🚨</div>
                <div :class="$style.blockerRemoteText">
                  <div :class="$style.blockerRemoteTitle">子会话正在等待授权</div>
                  <div :class="$style.blockerRemoteDesc">{{ remoteBlockedMeta?.toolName }}</div>
                </div>
                <button
                  type="button"
                  :class="$style.blockerRemoteBtn"
                  @click="jumpToBlockedSession(remoteBlocker.sessionId)"
                >
                  前往处理
                </button>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </template>
  </div>
</template>

<style module>
/* 主区：对话页填满 Content 席位（几何由壳承载，页内只管内容布局）；
   relative 为阻塞 Drawer 定位锚点（desktop .chat-area 同语义） */
.page {
  /* 宿主 ContentPane 为纵向 flex：flex:1 + min-height:0 撑满可视区（扣除顶部
     48px 拖动留白），消息流内部滚动、ChatInput 钉底——height:100% 在带 48px
     留白条的滚动容器里会超高 48px 且无法约束，会话内容一长输入区即被挤出视口 */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* 空会话 hero：垂直水平居中，标题在上、大输入卡在下（概念框架 §7，三期定稿保持） */
.hero {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-6);
  padding: var(--mx-space-6);
  overflow-y: auto;
}

.heroInput {
  width: 100%;
  max-width: 720px;
}

/* 消息流壳（desktop chat-messages-wrapper 同构）：滚动容器 + 覆盖层锚点；
   container 建立 inline-size 容器查询上下文（TurnRail 窄流隐藏判定），
   inline-size containment 不影响纵向 flex 布局 */
.streamWrap {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  container: chatflow-stream / inline-size;
}

/* 滚动容器（desktop chat-messages 同构）：--space-5(20px)→--mx-space-5、
   28px 侧距、平滑滚动 */
.stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--mx-space-5) 28px;
  scroll-behavior: smooth;
}

/* 轮列表（desktop messages-container 同构：max-width 920 居中 + gap 16）；
   三期 860/32 收敛回 desktop 值——与骨架屏（920）对齐，避免揭晓时宽度跳变 */
.roundsList {
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
}

.roundWrapper {
  min-width: 0;
}

/* 骨架屏覆盖层（desktop skeleton-overlay 同构）：--bg-primary→--mx-bg-window */
.skeletonOverlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: var(--mx-bg-window);
  overflow: hidden;
}

/* 压缩覆盖层（desktop compact-overlay 同构） */
.compactOverlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: var(--mx-bg-window);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-4);
}

/* spinner：--accent-cyan→--mx-accent */
.compactSpinner {
  width: 32px;
  height: 32px;
  border: 3px solid color-mix(in srgb, var(--mx-accent) 20%, transparent);
  border-top-color: var(--mx-accent);
  border-radius: 50%;
  animation: compact-spin 0.8s linear infinite;
}

/* compact-label：--font-lg→--mx-font-body（14px）、600、--text-muted→--mx-text-tertiary */
.compactLabel {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text-tertiary);
}

/* ── 阻塞交互 Drawer（AskUser / Permission）：自下而上滑出，遮挡 ChatInput ── */
/* desktop 同构：--bg-primary→--mx-bg-window */
.blockerDrawer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--mx-space-4);
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--mx-bg-window) 92%, transparent) 30%);
  pointer-events: none;
}

.blockerDrawerInner {
  width: 100%;
  max-width: 920px;
  pointer-events: auto;
  max-height: 60vh;
  overflow-y: auto;
}

/* 子代理提问直接作答：容器（无警示卡样式，提问表单即 AskUserView 本体） */
.blockerRemoteWrap {
  min-width: 0;
}

/* blocker-ask-agent：--font-sm→--mx-font-caption（11px）、--warning→--mx-warning */
.blockerAskAgent {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-warning);
  margin-bottom: var(--mx-space-2);
}

/* 子会话阻塞提示卡：提醒用户有子会话在等待授权/回答，点击前往处理。
   --radius-lg→--mx-radius-card、--bg-card→--mx-bg-elevated */
.blockerRemote {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3) var(--mx-space-4);
  border-radius: var(--mx-radius-card);
  background: color-mix(in srgb, var(--mx-warning) 10%, var(--mx-bg-elevated));
  border: 1px solid color-mix(in srgb, var(--mx-warning) 45%, transparent);
  animation: textBlink 1.6s ease-in-out infinite;
}

.blockerRemoteIcon {
  font: var(--mx-font-body);
  flex-shrink: 0;
}

.blockerRemoteText {
  flex: 1;
  min-width: 0;
}

/* blocker-remote-title：--font-md→--mx-font-body */
.blockerRemoteTitle {
  font: var(--mx-font-body);
  font-weight: 700;
  color: var(--mx-warning);
}

/* blocker-remote-desc：--font-sm→--mx-font-caption、--text-secondary→--mx-text-secondary */
.blockerRemoteDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* blocker-remote-btn：desktop color:#fff → 语义前景 --mx-text（禁字面色值） */
.blockerRemoteBtn {
  flex-shrink: 0;
  padding: var(--mx-space-2) var(--mx-space-4);
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text);
  background: var(--mx-warning);
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  transition: filter 0.2s;
}

.blockerRemoteBtn:hover {
  filter: brightness(1.1);
}

.blockerRemoteBtn:active {
  filter: brightness(0.92);
}

.blockerRemoteBtn:focus-visible {
  outline: 2px solid var(--mx-warning);
  outline-offset: 2px;
}
</style>

<!--
  过渡类与 keyframes：Vue transition 按 name 匹配全局类名（message-list-* / drawer-up-*），
  CSS module 会 hash 类名导致匹配不到，故独立全局样式块（desktop ChatArea 同构平移）。
-->
<style>
.message-list-enter-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.message-list-leave-active {
  transition: all 0.2s ease-in;
}

.message-list-enter-from {
  opacity: 0;
  transform: translateY(-16px);
}

.message-list-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.drawer-up-enter-active,
.drawer-up-leave-active {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
}

.drawer-up-enter-from,
.drawer-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

@keyframes textBlink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.82;
  }
}
</style>
