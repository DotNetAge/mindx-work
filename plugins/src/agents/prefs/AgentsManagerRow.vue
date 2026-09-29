<script setup lang="ts">
/**
 * 团队管理行："团队"设置页唯一自定义行，承载完整管理器（skills 管理行先例）。
 * 布局为上下结构（桌面端左右结构移植改形）：
 * 上 = 员工卡片网格（团队视图：已招募员工；市场视图：agent 类型分发包货架），
 * 下 = 选中员工的配置面板（头部 + 指令/技能/云技能/工具四区）。
 * 市场卡片详情为 FLIP 分段动效弹层（ghost 卡片拉宽→拉高→到位即呈现），
 * 贴触发点的局部浮层由组件自绘（契约 §6）；确认/许可证走壳 Overlay modal。
 * 注意壳 modal z 序低于本组件 Teleport 层——弹层内动作先硬关弹层再开 modal。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useCssModule, watch } from 'vue'
import type { Component } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import {
  useAgentsStore,
  agentDisplayName,
  agentRoleSubtitle,
  marketPkgDisplayName,
  marketPkgRoleSubtitle,
  skillDisplayName,
  skillLocaleDesc,
  AgentExistsError,
} from '../store'
import { pushNotice } from '../notice'
import { MODAL_AGENTS_CONFIRM, MODAL_AGENTS_LICENSE } from '../ids'
import ConfirmModal from '../overlays/ConfirmModal.vue'
import LicenseModal from '../overlays/LicenseModal.vue'
import type { AgentMeta, MarketAgentPackage, SkillInfo } from '../types'
import {
  AGENT_TOOLS,
  AGENT_TOOL_GROUPS,
  STANDALONE_AGENT_TOOLS,
  TOOL_LABELS,
  TOOL_DESCS,
  GROUP_LABELS,
  GROUP_DESCS,
} from '../types'

const store = useAgentsStore()
const shell = useShell()
// script 内访问 CSS module 需显式取用（$style 仅为模板可用）
const $style = useCssModule()

onMounted(() => {
  store.loadAgents().catch((err: unknown) => {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '智能体列表加载失败，请检查与守护进程的连接')
  })
  store.loadSkills().catch(() => {
    // 技能加载失败仅降级为显示原始技能名，不阻断员工管理
  })
  store.loadConnectors().catch(() => {
    // 云技能清单加载失败在云技能区内呈现空态文案
  })
})

/** modal 互斥惯例：add 前先 remove 同 id（契约 §6） */
function openModal(id: string, component: Component) {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
  shell.Overlay.add({ id, kind: 'modal', component })
}

function openConfirm(): void {
  openModal(MODAL_AGENTS_CONFIRM, ConfirmModal)
}

function openLicense(name: string, content: string): void {
  store.openLicense(`许可证 — ${name}`, content)
  openModal(MODAL_AGENTS_LICENSE, LicenseModal)
}

// ── 视图切换：团队 / 市场（市场懒加载：首次切到才拉清单） ──
const view = ref<'team' | 'market'>('team')

watch(view, (v) => {
  if (v !== 'market' || store.marketLoading) return
  // 每次切入都重拉：已有清单先渲染旧数据，后台静默刷新（stale-while-revalidate），
  // 避免 daemon/线上清单更新后前端内存旧分类永不失效
  void onMarketRefresh()
})

async function onMarketRefresh() {
  try {
    await store.loadMarket()
  } catch (err: unknown) {
    // 已有数据的静默刷新失败不打扰（旧清单仍可浏览），仅首拉失败提示
    if (!store.marketLoaded) {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '市场清单加载失败，请检查网络连接')
    }
  }
}

// ── 团队视图：搜索筛选（已招募员工） ──
const search = ref('')

const teamCards = computed<AgentMeta[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return store.hiredAgents
  return store.hiredAgents.filter((a) => {
    const hay = [a.name, agentDisplayName(a), a.description || ''].join(' ').toLowerCase()
    return hay.includes(q)
  })
})

/** 卡片评分（meta.ratings，未声明不显示） */
function ratingsOf(a: AgentMeta): number {
  const r = a.meta?.ratings
  return typeof r === 'number' ? r : Number(r) || 0
}

// ── 选中员工（下方配置面板数据源）；清单变化时回落到第一个已招募者 ──
const selectedName = ref('')
const selectedAgent = computed<AgentMeta | null>(
  () => store.hiredAgents.find((a) => a.name === selectedName.value) || null,
)

watch(
  () => store.hiredAgents,
  (list) => {
    if (selectedName.value && !list.some((a) => a.name === selectedName.value)) {
      selectedName.value = list[0]?.name || ''
    } else if (!selectedName.value && list.length > 0) {
      selectedName.value = list[0]?.name || ''
    }
  },
)

// ── 配置区编辑态（技能 / 工具 / 云技能勾选的本地副本，保存时统一写回） ──
const editorTab = ref<'instructions' | 'skills' | 'cloud' | 'tools' | 'team'>('instructions')
const isEditing = ref(false)
const localSkills = ref<string[]>([])
const localEnabledTools = ref<Set<string>>(new Set())
const localAllowedServers = ref<Set<string>>(new Set())
/** 云技能勾选基线（取消编辑时回滚用） */
const allowedBaseline = ref<Set<string>>(new Set())

function initEditor(name: string): void {
  const a = store.agents.find((x) => x.name === name)
  localSkills.value = [...(a?.skills || [])]
  // 工具启用 = 全量 - exclude_tools
  const excluded = new Set(a?.exclude_tools || [])
  localEnabledTools.value = new Set(AGENT_TOOLS.map((t) => t.name).filter((n) => !excluded.has(n)))
  localAllowedServers.value = new Set(allowedBaseline.value)
}

// ── 指令正文（agent.get：introduction 即 IDENTITY 正文，soul 即 SOUL 正文） ──
const activeChip = ref<'identity' | 'soul'>('identity')
const identityBody = ref('')
const soulBody = ref('')
const identityDirty = ref(false)
const soulDirty = ref(false)
/** 团队职责（TEAM.md 正文，仅负责人可编辑） */
const teamBody = ref('')
const teamDirty = ref(false)
const detailLoading = ref(false)
/** 请求序号：快速切换员工时丢弃过期响应 */
let detailReqSeq = 0

async function loadAgentBodies(name: string): Promise<void> {
  const seq = ++detailReqSeq
  identityBody.value = ''
  soulBody.value = ''
  teamBody.value = ''
  identityDirty.value = false
  soulDirty.value = false
  teamDirty.value = false
  if (!name) {
    allowedBaseline.value = new Set()
    localAllowedServers.value = new Set()
    return
  }
  detailLoading.value = true
  try {
    const res = await store.loadAgentDetail(name)
    if (seq !== detailReqSeq || name !== selectedName.value) return
    identityBody.value = String(res?.introduction ?? '')
    soulBody.value = String(res?.soul ?? '')
    teamBody.value = String(res?.team_duty ?? '')
    // allows_tools 条目为 "mcp:<server>"，解析出 server 名集合作为云技能勾选基线
    const allowed = new Set<string>()
    for (const raw of res?.allows_tools || []) {
      const m = /^mcp:(.+)$/.exec(String(raw).trim())
      if (m?.[1]) allowed.add(m[1])
    }
    allowedBaseline.value = allowed
    localAllowedServers.value = new Set(allowed)
  } catch (err: unknown) {
    if (seq === detailReqSeq) {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '加载员工详情失败')
    }
  } finally {
    if (seq === detailReqSeq) detailLoading.value = false
  }
}

watch(selectedName, (name) => {
  isEditing.value = false
  editorTab.value = 'instructions'
  activeChip.value = 'identity'
  initEditor(name)
  void loadAgentBodies(name)
  void nextTick(() => syncIndicator(configTabsRef.value))
})

// ── 指令保存（身份写 identity_body，行为准则写 soul，团队职责写 team_duty；独立于全局编辑态） ──
async function saveBody(section: 'identity' | 'soul' | 'team'): Promise<void> {
  const name = selectedName.value
  if (!name) return
  const field = section === 'identity' ? 'identity_body' : section === 'soul' ? 'soul' : 'team_duty'
  const value = section === 'identity' ? identityBody.value : section === 'soul' ? soulBody.value : teamBody.value
  try {
    await store.updateAgent({ name, [field]: value })
    if (section === 'identity') identityDirty.value = false
    else if (section === 'soul') soulDirty.value = false
    else teamDirty.value = false
    pushNotice(shell, 'success', 'Agent 保存成功')
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : 'Agent 保存失败')
  }
}

// ── 编辑态切换与保存（技能 / 云技能 / 工具共用一次 agent.update） ──
function startEditing(): void {
  isEditing.value = true
}

function cancelEditing(): void {
  initEditor(selectedName.value)
  isEditing.value = false
}

async function handleSave(): Promise<void> {
  const name = selectedName.value
  if (!name) return
  // 计算 exclude_tools = 所有工具 - 启用工具；云技能勾选 → allows_tools（条目 "mcp:<server>"）
  const excludeTools = AGENT_TOOLS.map((t) => t.name).filter((n) => !localEnabledTools.value.has(n))
  const allowsTools = [...localAllowedServers.value].map((n) => `mcp:${n}`)
  try {
    await store.updateAgent({
      name,
      skills: localSkills.value,
      exclude_tools: excludeTools,
      allows_tools: allowsTools,
    })
    // 局部同步清单条目（查看态摘要即时一致）
    const a = store.agents.find((x) => x.name === name)
    if (a) {
      a.skills = [...localSkills.value]
      a.exclude_tools = excludeTools
      a.allows_tools = allowsTools
    }
    allowedBaseline.value = new Set(localAllowedServers.value)
    isEditing.value = false
    pushNotice(shell, 'success', 'Agent 保存成功')
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : 'Agent 保存失败')
  }
}

// ── 工具列表（混合独立工具与工具组，含展示名/描述） ──
interface ToolItem {
  type: 'tool' | 'group'
  key: string
  name: string
  label: string
  desc: string
  enabled: boolean
  indeterminate?: boolean
  members?: string[]
}

const toolsList = computed<ToolItem[]>(() => {
  const standalone: ToolItem[] = STANDALONE_AGENT_TOOLS.map((tool) => ({
    type: 'tool',
    key: tool.name,
    name: tool.name,
    label: TOOL_LABELS[tool.name] || tool.name,
    desc: TOOL_DESCS[tool.name] || tool.desc,
    enabled: localEnabledTools.value.has(tool.name),
  }))
  const groups: ToolItem[] = AGENT_TOOL_GROUPS.map((g) => {
    const enabledCount = g.members.filter((m) => localEnabledTools.value.has(m)).length
    const all = enabledCount === g.members.length
    return {
      type: 'group',
      key: g.key,
      name: g.key,
      label: GROUP_LABELS[g.key] || g.key,
      desc: GROUP_DESCS[g.key] || '',
      enabled: all,
      indeterminate: enabledCount > 0 && !all,
      members: g.members,
    }
  })
  return [...standalone, ...groups]
})

function toggleTool(name: string, enable: boolean): void {
  const next = new Set(localEnabledTools.value)
  if (enable) next.add(name)
  else next.delete(name)
  localEnabledTools.value = next
}

function toggleGroup(members: string[], enable: boolean): void {
  const next = new Set(localEnabledTools.value)
  for (const m of members) {
    if (enable) next.add(m)
    else next.delete(m)
  }
  localEnabledTools.value = next
}

function toggleAllTools(enable: boolean): void {
  localEnabledTools.value = enable ? new Set(AGENT_TOOLS.map((t) => t.name)) : new Set()
}

function allToolsEnabled(): boolean {
  return AGENT_TOOLS.every((t) => localEnabledTools.value.has(t.name))
}

function someToolsEnabled(): boolean {
  return localEnabledTools.value.size > 0 && localEnabledTools.value.size < AGENT_TOOLS.length
}

// ── 技能列表（技能分配多选源 = 全局技能库） ──
interface SkillItem {
  name: string
  origName: string
  desc: string
  assigned: boolean
  author: string
  version: string
  license: string
}

const skillsList = computed<SkillItem[]>(() => {
  return store.skills.map((s) => ({
    name: skillDisplayName(s),
    origName: s.name,
    desc: skillLocaleDesc(s),
    assigned: localSkills.value.includes(s.name),
    author: s.metadata?.author || '',
    version: s.metadata?.version || '',
    license: s.license || '',
  }))
})

function toggleSkill(name: string, assign: boolean): void {
  if (assign) {
    if (!localSkills.value.includes(name)) localSkills.value = [...localSkills.value, name]
  } else {
    localSkills.value = localSkills.value.filter((s) => s !== name)
  }
}

function toggleAllSkills(assign: boolean): void {
  localSkills.value = assign ? store.skills.map((s) => s.name) : []
}

function allSkillsAssigned(): boolean {
  return store.skills.length > 0 && localSkills.value.length === store.skills.length
}

function someSkillsAssigned(): boolean {
  return localSkills.value.length > 0 && localSkills.value.length < store.skills.length
}

/** 查看态摘要：已分配技能条目 */
const assignedSkills = computed<SkillInfo[]>(() =>
  store.skills.filter((s) => localSkills.value.includes(s.name)),
)

/** 是否第三方技能（有作者或许可证声明） */
function isThirdParty(s: SkillItem): boolean {
  return !!(s.author || s.license)
}

// ── 云技能勾选 ──
function toggleConnector(name: string, enable: boolean): void {
  const next = new Set(localAllowedServers.value)
  if (enable) next.add(name)
  else next.delete(name)
  localAllowedServers.value = next
}

function toggleAllConnectors(enable: boolean): void {
  localAllowedServers.value = enable ? new Set(store.connectors.map((c) => c.name)) : new Set()
}

/** 查看态摘要：已勾选云技能条目 */
const allowedConnectors = computed(() =>
  store.connectors.filter((c) => localAllowedServers.value.has(c.name)),
)

/** 查看态摘要：已启用工具组（全部成员启用才算完整组） */
const enabledToolGroups = computed(() =>
  AGENT_TOOL_GROUPS.filter((g) => g.members.every((m) => localEnabledTools.value.has(m))),
)

/** 查看态摘要：已启用独立工具 */
const enabledStandaloneTools = computed(() =>
  STANDALONE_AGENT_TOOLS.filter((t) => localEnabledTools.value.has(t.name)),
)

// ── 散伙守卫：系统至少保留一个已招募智能体（daemon agent.fire 同源守卫，UI 先禁用防误点）──
const canFire = computed(() => store.agents.filter((a) => a.hired).length > 1)

// ── 昵称编辑（配置头部标识行点击触发）：agent.update nick_name（空串清空，展示回退 role/name）──
const editingNick = ref(false)
const nickDraft = ref('')
const nickInputEl = ref<HTMLInputElement | null>(null)

function startNickEdit(): void {
  if (!selectedAgent.value || store.operating === selectedAgent.value.name) return
  nickDraft.value = selectedAgent.value.nick_name || ''
  editingNick.value = true
  nextTick(() => nickInputEl.value?.focus())
}

function cancelNick(): void {
  editingNick.value = false
}

async function saveNick(): Promise<void> {
  if (!editingNick.value || !selectedAgent.value) return
  const agent = selectedAgent.value
  const next = nickDraft.value.trim()
  if (next === (agent.nick_name || '')) {
    editingNick.value = false // 未变化直接退出编辑
    return
  }
  editingNick.value = false
  store.operating = agent.name
  try {
    await store.updateAgent({ name: agent.name, nick_name: next })
    await store.refreshAgents()
    pushNotice(shell, 'success', next ? `昵称已更新为「${next}」` : '昵称已清除')
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '昵称更新失败')
  } finally {
    store.operating = ''
  }
}

// ── 团队（配置头部）：成员头像堆叠（Leader 取 members，成员取同 team 同伴）；
// 非团队显示「组队」入口，弹层写 team + members（members 非空即自任负责人） ──
interface TeamStackAvatar {
  name: string
  displayName: string
  icon?: string
}

const teamMemberAvatars = computed<TeamStackAvatar[]>(() => {
  const agent = selectedAgent.value
  if (!agent) return []
  let names: string[]
  if (agent.is_leader && agent.members?.length) {
    names = agent.members
  } else if (agent.team) {
    names = store.agents.filter((a) => a.team === agent.team && a.name !== agent.name).map((a) => a.name)
  } else {
    return []
  }
  return names
    .map((name) => {
      const meta = store.agents.find((a) => a.name === name)
      return { name, displayName: meta ? agentDisplayName(meta) : name, icon: meta?.icon }
    })
    .filter((m) => !!m)
})

// ── 组队对话框（非团队 agent 的「组队」入口）：队名 +「+」添加成员 + 成员头像预览；
// 全程草稿态（draftMembers），保存时一次写 team + members（含自己即自任负责人） ──
const teamModalOpen = ref(false)
const teamNameDraft = ref('')
const draftMembers = ref<string[]>([])
const memberPickerOpen = ref(false)
const memberPicks = ref<string[]>([])

const hireableMembers = computed(() => store.agents.filter((a) => a.hired && a.name !== selectedAgent.value?.name))

/** 对话框内成员头像预览（草稿名单 → 清单匹配头像/展示名） */
const draftMemberAvatars = computed(() =>
  draftMembers.value.map((name) => {
    const meta = store.agents.find((a) => a.name === name)
    return { name, displayName: meta ? agentDisplayName(meta) : name, icon: meta?.icon }
  })
)

function openTeamModal(): void {
  teamNameDraft.value = ''
  draftMembers.value = []
  memberPickerOpen.value = false
  memberPicks.value = []
  teamModalOpen.value = true
}

/** 浮层「确定」：勾选并入草稿名单（对话框内头像即时预览） */
function confirmPicks(): void {
  draftMembers.value = Array.from(new Set([...draftMembers.value, ...memberPicks.value]))
  memberPicks.value = []
  memberPickerOpen.value = false
}

async function saveTeam(): Promise<void> {
  const agent = selectedAgent.value
  if (!agent) return
  const team = teamNameDraft.value.trim()
  if (!team) {
    pushNotice(shell, 'error', '队名不能为空')
    return
  }
  teamModalOpen.value = false
  store.operating = agent.name
  try {
    await store.updateAgent({ name: agent.name, team, members: Array.from(new Set([agent.name, ...draftMembers.value])) })
    await store.refreshAgents()
    pushNotice(shell, 'success', `已加入团队「${team}」`)
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '组队失败')
  } finally {
    store.operating = ''
  }
}

// ── 散伙（团队卡片 / 配置头部 / 市场卡片 / 详情弹层共用） ──
function onFire(name: string, display: string): void {
  store
    .fire(name)
    .then(() => pushNotice(shell, 'success', `已散伙「${display}」，将不再用于新会话`))
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
    })
}

// ── 市场视图：搜索 + 分类筛选 ──
const marketSearch = ref('')
const marketDomain = ref('')

const marketCards = computed<MarketAgentPackage[]>(() => {
  const q = marketSearch.value.trim().toLowerCase()
  return store.marketPackages.filter((p) => {
    if (marketDomain.value && (p.category || '').trim() !== marketDomain.value) return false
    if (!q) return true
    const hay = [
      p.name,
      marketPkgDisplayName(p),
      p.description || '',
      (p.category || '').trim(),
      ...(p.skills ?? []).map((s) => store.skillZhMap[s] || p.skillNames?.[s] || s),
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

/** 已招募员工名集合（市场卡片招募态标签口径：本地注册表且 hired） */
const hiredNames = computed<Set<string>>(() => new Set(store.hiredAgents.map((a) => a.name)))

/**
 * 市场卡片招募（一键语义）：始终先安装（市场包自包含技能装配）再雇佣。
 * 同名冲突走覆盖确认后重试。
 */
function onRecruit(pkg: MarketAgentPackage): void {
  void store
    .recruitMarketPackage(pkg)
    .then(() => {
      pushNotice(shell, 'success', `已招募「${marketPkgDisplayName(pkg)}」，现在可用于会话`)
    })
    .catch((err: unknown) => {
      if (err instanceof AgentExistsError) {
        const m = err.message.match(/已存在同名智能体\s*"([^"]+)"/)
        store.requestConfirm(
          '同名冲突',
          `已存在同名智能体「${m?.[1] || pkg.name}」，是否覆盖？覆盖后原内容将被替换，不可恢复。`,
          '覆盖',
          `已覆盖安装「${marketPkgDisplayName(pkg)}」并重新招募`,
          async () => {
            await store.installAgentPackage(pkg, true)
            await Promise.all([store.refreshAgents(), store.loadSkills()])
            await store.hire(pkg.name)
          },
        )
        openConfirm()
        return
      }
      pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
    })
}

function onMarketFire(pkg: MarketAgentPackage): void {
  const a = store.agents.find((x) => x.name === pkg.name)
  onFire(pkg.name, a ? agentDisplayName(a) : marketPkgDisplayName(pkg))
}

// ── 市场详情弹层（FLIP 分段动效）：头部卡 + 技能装备清单 + 招募/散伙 ──
// 动效编排（只动 transform/opacity，GPU 合成零重排，不用 backdrop-filter）：
// 点击卡片 → ① 拉长左右至弹层宽度 → ② 拉长上下至弹层高度，到位即终结（弹层立即呈现，无淡入尾段）；
// 关闭时反向：先收上下 → 再收左右 → 落回格子。

/** 技能装备清单条目（中文名回退链：本地库 metadata.name_zh → 包清单 skillNames → 原名） */
interface DetailSkillItem {
  name: string
  nameZh: string
  desc: string
  version: string
}

interface ZoomTarget {
  pkg: MarketAgentPackage
  /** 展示名（role 优先） */
  title: string
  name: string
  description: string
  category: string
  version: string
  hired: boolean
  installed: boolean
  skillItems: DetailSkillItem[]
}

const zoomed = ref<ZoomTarget | null>(null)
/** true = 弹层已挂载但隐藏，等待 ghost 分段动画到位后立即呈现 */
const zoomPreparing = ref(true)
const zoomClosing = ref(false)
const zoomCardRef = ref<HTMLElement | null>(null)

/** FLIP ghost 元素与来源卡片（命令式管理，随动画创建/销毁） */
let zoomGhost: HTMLDivElement | null = null
let zoomSourceEl: HTMLElement | null = null
let zoomAnim: Animation | null = null

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 在来源卡片位置创建 ghost（纯色圆角盒，scale 拉伸不会暴露形变） */
function createGhost(rect: DOMRect): HTMLDivElement {
  const g = document.createElement('div')
  g.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    'background:var(--mx-bg-surface)',
    'border:0.5px solid var(--mx-separator-soft)',
    'border-radius:var(--mx-radius-card)',
    'box-shadow:var(--mx-shadow-prominent)',
    'z-index:2001',
    'pointer-events:none',
    'transform-origin:top left',
  ].join(';')
  document.body.appendChild(g)
  return g
}

function removeGhost(): void {
  zoomAnim?.cancel()
  zoomAnim = null
  zoomGhost?.remove()
  zoomGhost = null
}

function restoreSourceCard(): void {
  if (zoomSourceEl) zoomSourceEl.style.visibility = ''
  zoomSourceEl = null
}

function disposeZoomOverlay(): void {
  removeGhost()
  restoreSourceCard()
  zoomed.value = null
  zoomPreparing.value = true
  zoomClosing.value = false
}

/** 打开详情：拉宽 → 拉高 → 到位即呈现 */
function openZoomWith(target: ZoomTarget, sourceEl: HTMLElement | null): void {
  zoomClosing.value = false
  zoomPreparing.value = true
  zoomed.value = target

  // reduced motion：跳过分段动画，弹层直接呈现
  if (prefersReducedMotion) {
    zoomPreparing.value = false
    return
  }

  // 卡片让位给 ghost（同一帧无缝换位，视觉上就是卡片自己移位）
  restoreSourceCard()
  zoomSourceEl = sourceEl
  if (zoomSourceEl) zoomSourceEl.style.visibility = 'hidden'
  const cardRect = zoomSourceEl
    ? zoomSourceEl.getBoundingClientRect()
    : new DOMRect(window.innerWidth / 2 - 200, window.innerHeight / 2 - 120, 400, 240)
  removeGhost()
  zoomGhost = createGhost(cardRect)

  void nextTick(() => {
    if (!zoomGhost || !zoomed.value) return
    const dialogRect = zoomCardRef.value?.getBoundingClientRect()
    if (!dialogRect || dialogRect.width === 0) {
      // 弹层量不到尺寸（异常兜底）：跳过动画直接呈现
      removeGhost()
      restoreSourceCard()
      zoomPreparing.value = false
      return
    }
    const dx = dialogRect.left - cardRect.left
    const dy = dialogRect.top - cardRect.top
    const sx = dialogRect.width / cardRect.width
    const sy = dialogRect.height / cardRect.height
    zoomAnim = zoomGhost.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        // ① 拉长左右至弹层宽度
        { transform: `translate(${dx}px, 0px) scale(${sx}, 1)`, offset: 0.55, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        // ② 拉长上下至弹层高度，到位即终结（弹层立即接管，无淡入尾段）
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, offset: 1 },
      ],
      { duration: 620, fill: 'forwards' },
    )
    zoomAnim.onfinish = () => {
      // 换位顺序不能反：先让弹层立即不透明（与 ghost 同矩形同底色，视觉无缝），
      // 渲染一帧后再撤 ghost 与恢复卡片——若先撤 ghost，落位矩形会出现一帧大空隙
      if (zoomed.value) zoomPreparing.value = false
      void nextTick(() => {
        removeGhost()
        restoreSourceCard()
      })
    }
  })
}

function openZoomMarket(pkg: MarketAgentPackage, e?: Event): void {
  const skillMap = new Map(store.skills.map((s) => [s.name, s]))
  const skillItems: DetailSkillItem[] = (pkg.skills ?? []).map((n) => {
    const s = skillMap.get(n)
    if (!s) {
      // 本地技能库无详情（未安装 / 技能库未加载）：中文名/描述回退包清单映射；版本回退包版本
      return {
        name: n,
        nameZh: pkg.skillNames?.[n] || n,
        desc: pkg.skillDescs?.[n] || '',
        version: pkg.version || '',
      }
    }
    // 技能展示名/描述以 frontmatter 中文名（metadata.name_zh/description_zh）优先
    return {
      name: n,
      nameZh: skillDisplayName(s),
      desc: skillLocaleDesc(s),
      version: s.metadata?.version || '',
    }
  })
  const installed = store.installedNames.has(pkg.name)
  openZoomWith(
    {
      pkg,
      title: marketPkgDisplayName(pkg),
      name: pkg.name,
      description: pkg.description || '暂无描述',
      category: (pkg.category || '').trim(),
      version: pkg.version || '',
      hired: hiredNames.value.has(pkg.name),
      installed,
      skillItems,
    },
    (e?.currentTarget as HTMLElement) || null,
  )
}

/** 关闭详情：弹层淡出，ghost 反向收上下 → 收左右 → 落回格子 */
function closeZoom(): void {
  if (!zoomed.value || zoomClosing.value || zoomPreparing.value) return
  zoomClosing.value = true

  if (prefersReducedMotion) {
    window.setTimeout(disposeZoomOverlay, 160)
    return
  }

  const dialogRect = zoomCardRef.value?.getBoundingClientRect()
  const cardRect = zoomSourceEl?.getBoundingClientRect()
  if (!dialogRect || dialogRect.width === 0 || !cardRect || cardRect.width === 0) {
    window.setTimeout(disposeZoomOverlay, 200)
    return
  }
  const dx = dialogRect.left - cardRect.left
  const dy = dialogRect.top - cardRect.top
  const sx = dialogRect.width / cardRect.width
  const sy = dialogRect.height / cardRect.height
  removeGhost()
  zoomGhost = createGhost(dialogRect)
  zoomAnim = zoomGhost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, offset: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      // 反向 ① 收上下
      { transform: `translate(${dx}px, 0px) scale(${sx}, 1)`, offset: 0.55, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      // 反向 ② 收左右，落回格子
      { transform: 'translate(0px, 0px) scale(1, 1)', offset: 1 },
    ],
    { duration: 460, fill: 'forwards' },
  )
  zoomAnim.onfinish = () => {
    disposeZoomOverlay()
  }
}

/** Esc 收详情（capture 阶段拦截，避免壳同时把设置面板一并收起） */
function onZoomKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopImmediatePropagation()
    closeZoom()
  }
}

watch(zoomed, (v) => {
  if (v) window.addEventListener('keydown', onZoomKey, true)
  else window.removeEventListener('keydown', onZoomKey, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onZoomKey, true)
  disposeZoomOverlay()
})

/** 弹层内招募：先硬关弹层再走安装流程（确认 modal 同受 z 序约束） */
function recruitFromZoom(target: ZoomTarget): void {
  disposeZoomOverlay()
  onRecruit(target.pkg)
}

/** 弹层内散伙：先硬关弹层再执行 */
function fireFromZoom(target: ZoomTarget): void {
  disposeZoomOverlay()
  onMarketFire(target.pkg)
}

// ── 分段页签指示器（.mx-tabs 指示器位移经 JS 写 transform；视图页签 + 配置区页签两处） ──
const viewTabsRef = ref<HTMLElement | null>(null)
const configTabsRef = ref<HTMLElement | null>(null)

function syncIndicator(root: HTMLElement | null): void {
  if (!root) return
  const tab = root.querySelector<HTMLButtonElement>('button[aria-selected="true"]')
  const ind = root.querySelector<HTMLElement>(':scope > [data-indicator]')
  if (!tab || !ind) return
  ind.style.width = `${tab.offsetWidth}px`
  ind.style.transform = `translateX(${tab.offsetLeft - 4}px)`
}

watch(view, () => void nextTick(() => syncIndicator(viewTabsRef.value)))
watch(editorTab, () => void nextTick(() => syncIndicator(configTabsRef.value)))
onMounted(() => {
  void nextTick(() => {
    syncIndicator(viewTabsRef.value)
    syncIndicator(configTabsRef.value)
  })
})
</script>

<template>
  <div :class="$style.wrap">
    <!-- 节头：标题 + 说明 -->
    <div :class="$style.sectionHead">
      <div :class="$style.headText">
        <span :class="$style.sectionTitle">团队</span>
        <span :class="$style.sectionHint">配置员工的基本能力与技能；点击员工卡片展开配置，到市场招募新员工</span>
      </div>
    </div>

    <!-- 工具栏：页签独占一行居中，搜索独占一行全宽（计数与手动刷新冗余，已删） -->
    <div :class="$style.tabsRow">
      <div ref="viewTabsRef" class="mx-tabs" :class="$style.viewTabs">
        <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
        <button type="button" class="mx-tab" role="tab" :aria-selected="view === 'team' ? 'true' : 'false'" @click="view = 'team'">
          团队
        </button>
        <button type="button" class="mx-tab" role="tab" :aria-selected="view === 'market' ? 'true' : 'false'" @click="view = 'market'">
          市场
        </button>
      </div>
    </div>
    <input
      v-if="view === 'team'"
      v-model="search"
      class="mx-input"
      :class="$style.search"
      placeholder="搜索名称、角色或描述"
    />
    <input
      v-else
      v-model="marketSearch"
      class="mx-input"
      :class="$style.search"
      placeholder="搜索名称、角色或描述"
    />

    <!-- 市场降级提示（在线拉取失败降级本地缓存） -->
    <p v-if="view === 'market' && store.marketWarning" :class="$style.warning">{{ store.marketWarning }}</p>

    <!-- 市场分类标签行（固定分类在前、其余字典序在后） -->
    <div v-if="view === 'market' && store.marketDomains.length > 0" :class="$style.domains">
      <button
        type="button"
        :class="$style.domainTag"
        :aria-pressed="marketDomain === '' ? 'true' : 'false'"
        @click="marketDomain = ''"
      >
        全部
      </button>
      <button
        v-for="d in store.marketDomains"
        :key="d"
        type="button"
        :class="$style.domainTag"
        :aria-pressed="marketDomain === d ? 'true' : 'false'"
        @click="marketDomain = marketDomain === d ? '' : d"
      >
        {{ d }}
      </button>
    </div>

    <!-- ── 团队视图（上：已招募员工迷你卡横排（供应商品牌卡同款）；下：选中员工配置面板） ── -->
    <template v-if="view === 'team'">
      <p v-if="store.loading && !store.loaded" :class="[$style.hint, 'mx-text-loading']">正在加载员工清单…</p>
      <div v-else-if="teamCards.length > 0" :class="$style.strip">
        <div
          v-for="a in teamCards"
          :key="a.name"
          role="button"
          tabindex="0"
          :class="$style.mCard"
          :data-active="a.name === selectedName ? 'true' : 'false'"
          @click="selectedName = a.name"
          @keydown.enter.prevent="selectedName = a.name"
        >
          <img v-if="a.icon" :class="[$style.mAvatar, $style.avatarImg]" :src="a.icon" :alt="agentDisplayName(a)" />
          <span v-else :class="$style.mAvatar">{{ (agentDisplayName(a) || '?').charAt(0).toUpperCase() }}</span>
          <span :class="$style.mName" :title="a.name">{{ agentDisplayName(a) }}</span>
          <span v-if="agentRoleSubtitle(a)" :class="$style.mRole">{{ agentRoleSubtitle(a) }}</span>
          <!-- 分类与市场统计标签：挪到卡片右端（原散伙按钮位）；散伙入口收进配置面板头部 -->
          <div :class="$style.mTags">
            <span v-if="(a.category || '').trim()" class="mx-tag" data-tone="info">{{ (a.category || '').trim() }}</span>
            <span v-if="ratingsOf(a) > 0" class="mx-tag" data-tone="neutral">★ {{ ratingsOf(a) }}</span>
            <span v-if="(a.skills || []).length" class="mx-tag" data-tone="warning">{{ (a.skills || []).length }} 个技能</span>
          </div>
        </div>
      </div>
      <div v-else :class="$style.emptyBox">
        <p :class="$style.hint">团队里还没有智能体</p>
        <button type="button" class="mx-btn mx-btn--primary" @click="view = 'market'">去招募</button>
      </div>

      <!-- ── 下方配置面板（上下结构的"下"） ── -->
      <div v-if="selectedAgent" :class="$style.config">
        <!-- 头部：头像 + 角色名 + 标识 + 描述 + 散伙 -->
        <div :class="$style.cfgHead">
          <img
            v-if="selectedAgent.icon"
            :class="[$style.cfgAvatar, $style.avatarImg]"
            :src="selectedAgent.icon"
            :alt="agentDisplayName(selectedAgent)"
          />
          <span v-else :class="$style.cfgAvatar">{{ (agentDisplayName(selectedAgent) || '?').charAt(0).toUpperCase() }}</span>
          <div :class="$style.cfgMain">
            <div :class="$style.cfgNameRow">
              <h3 :class="$style.cfgName">{{ agentDisplayName(selectedAgent) }}</h3>
              <span v-if="agentRoleSubtitle(selectedAgent)" :class="$style.cfgRole">{{ agentRoleSubtitle(selectedAgent) }}</span>
              <!-- Leader 在标题旁显示团队名 -->
              <span v-if="selectedAgent.is_leader && selectedAgent.team" class="mx-tag" data-tone="info">{{ selectedAgent.team }}</span>
            </div>
            <!-- 标识行（name 小字）：点击进入昵称编辑（改名不影响目录名，展示名随之刷新） -->
            <input
              v-if="editingNick"
              ref="nickInputEl"
              v-model="nickDraft"
              :class="$style.cfgId"
              :disabled="store.operating === selectedAgent.name"
              placeholder="设置昵称，留空清除"
              @keydown.enter.prevent="saveNick"
              @keydown.esc.prevent="cancelNick"
              @blur="saveNick"
            />
            <span
              v-else
              :class="[$style.cfgId, $style.cfgIdEditable]"
              title="点击修改昵称"
              @click="startNickEdit"
            >{{ selectedAgent.name }}</span>
            <p :class="$style.cfgDesc">{{ selectedAgent.description || '暂无描述' }}</p>
          </div>
          <!-- 团队区：有团队显示成员头像堆叠（紧密排列，前一个覆盖后一个左边一半）；
               非团队显示「组队」入口，点击弹组队对话框（队名 + 添加成员 + 成员头像） -->
          <div v-if="teamMemberAvatars.length" :class="$style.teamStack" title="团队成员">
            <template v-for="m in teamMemberAvatars" :key="m.name">
              <img v-if="m.icon" :class="$style.teamStackAvatar" :src="m.icon" :alt="m.displayName" :title="m.displayName" />
              <span v-else :class="$style.teamStackAvatar" :title="m.displayName">{{ m.displayName.charAt(0).toUpperCase() }}</span>
            </template>
          </div>
          <button
            v-else
            type="button"
            class="mx-btn"
            :disabled="store.operating === selectedAgent.name"
            @click="openTeamModal"
          >
            组队
          </button>
          <button
            type="button"
            class="mx-btn"
            :disabled="store.operating === selectedAgent.name || !canFire"
            :title="!canFire ? '系统至少需要保留一个智能体' : undefined"
            @click="onFire(selectedAgent.name, agentDisplayName(selectedAgent))"
          >
            <span v-if="store.operating === selectedAgent.name" class="mx-text-loading">执行中…</span>
            <template v-else>散伙</template>
          </button>
        </div>

        <!-- 四区页签 + 编辑操作 -->
        <div :class="$style.cfgTabsRow">
          <div ref="configTabsRef" class="mx-tabs" :class="$style.cfgTabs">
            <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
            <button type="button" class="mx-tab" role="tab" :aria-selected="editorTab === 'instructions' ? 'true' : 'false'" @click="editorTab = 'instructions'">
              指令
            </button>
            <button type="button" class="mx-tab" role="tab" :aria-selected="editorTab === 'skills' ? 'true' : 'false'" @click="editorTab = 'skills'">
              技能<template v-if="isEditing">&nbsp;({{ localSkills.length }}/{{ store.skills.length }})</template>
            </button>
            <button type="button" class="mx-tab" role="tab" :aria-selected="editorTab === 'cloud' ? 'true' : 'false'" @click="editorTab = 'cloud'">
              云技能<template v-if="isEditing">&nbsp;({{ localAllowedServers.size }}/{{ store.connectors.length }})</template>
            </button>
            <button type="button" class="mx-tab" role="tab" :aria-selected="editorTab === 'tools' ? 'true' : 'false'" @click="editorTab = 'tools'">
              工具<template v-if="isEditing">&nbsp;({{ localEnabledTools.size }}/{{ AGENT_TOOLS.length }})</template>
            </button>
            <!-- 团队职责：仅负责人可见（agent.Team 不为空且 is_leader） -->
            <button
              v-if="selectedAgent.is_leader && selectedAgent.team"
              type="button"
              class="mx-tab"
              role="tab"
              :aria-selected="editorTab === 'team' ? 'true' : 'false'"
              @click="editorTab = 'team'"
            >
              团队
            </button>
          </div>
          <div v-if="editorTab !== 'instructions'" :class="$style.cfgActions">
            <template v-if="!isEditing">
              <button type="button" class="mx-btn" @click="startEditing">编辑</button>
            </template>
            <template v-else>
              <button type="button" class="mx-btn" @click="cancelEditing">取消</button>
              <button type="button" class="mx-btn mx-btn--primary" @click="handleSave">保存</button>
            </template>
          </div>
        </div>

        <!-- 区：指令（档案/准则 chips 切换 + textarea 编辑，独立保存） -->
        <div v-show="editorTab === 'instructions'" :class="$style.tabPanel">
          <div :class="$style.chipRow">
            <button
              type="button"
              :class="$style.chip"
              :aria-pressed="activeChip === 'identity' ? 'true' : 'false'"
              @click="activeChip = 'identity'"
            >
              员工档案
            </button>
            <button
              type="button"
              :class="$style.chip"
              :aria-pressed="activeChip === 'soul' ? 'true' : 'false'"
              @click="activeChip = 'soul'"
            >
              行为准则
            </button>
          </div>
          <p v-if="detailLoading" :class="[$style.hint, 'mx-text-loading']">正在加载指令正文…</p>
          <template v-else>
            <div v-show="activeChip === 'identity'" :class="$style.instructionBlock">
              <textarea
                v-model="identityBody"
                :class="$style.area"
                rows="8"
                placeholder="员工档案（IDENTITY.md 正文），暂无内容"
                @input="identityDirty = true"
              ></textarea>
              <div :class="$style.instructionFoot">
                <span :class="$style.hint">保存后写入 IDENTITY.md 正文</span>
                <button type="button" class="mx-btn mx-btn--primary" :disabled="!identityDirty" @click="saveBody('identity')">保存</button>
              </div>
            </div>
            <div v-show="activeChip === 'soul'" :class="$style.instructionBlock">
              <textarea
                v-model="soulBody"
                :class="$style.area"
                rows="8"
                placeholder="行为准则（SOUL.md 正文），暂无内容"
                @input="soulDirty = true"
              ></textarea>
              <div :class="$style.instructionFoot">
                <span :class="$style.hint">保存后写入 SOUL.md 正文</span>
                <button type="button" class="mx-btn mx-btn--primary" :disabled="!soulDirty" @click="saveBody('soul')">保存</button>
              </div>
            </div>
          </template>
        </div>

        <!-- 区：团队职责（TEAM.md，仅负责人可见的页签内容） -->
        <div v-show="editorTab === 'team'" :class="$style.tabPanel">
          <p v-if="detailLoading" :class="[$style.hint, 'mx-text-loading']">正在加载团队职责…</p>
          <div v-else :class="$style.instructionBlock">
            <textarea
              v-model="teamBody"
              :class="$style.area"
              rows="8"
              placeholder="团队职责（TEAM.md 正文），暂无内容"
              @input="teamDirty = true"
            ></textarea>
            <div :class="$style.instructionFoot">
              <span :class="$style.hint">保存后写入 TEAM.md 正文</span>
              <button type="button" class="mx-btn mx-btn--primary" :disabled="!teamDirty" @click="saveBody('team')">保存</button>
            </div>
          </div>
        </div>

        <!-- 区：技能（查看态摘要 / 编辑态多选） -->
        <div v-show="editorTab === 'skills'" :class="$style.tabPanel">
          <div v-if="!isEditing" :class="$style.summaryList">
            <div v-for="sk in assignedSkills" :key="sk.name" :class="$style.summaryItem">
              <div :class="$style.summaryTitle">{{ skillDisplayName(sk) }}</div>
              <div :class="$style.summaryDesc">{{ skillLocaleDesc(sk) }}</div>
              <div :class="$style.summaryMeta">
                <span v-if="sk.metadata?.author" class="mx-tag" data-tone="neutral">{{ sk.metadata?.author }}</span>
                <span v-if="sk.metadata?.version" class="mx-tag" data-tone="info">v{{ sk.metadata?.version }}</span>
                <span
                  v-if="sk.license"
                  :class="$style.licenseTag"
                  role="button"
                  tabindex="0"
                  @click="openLicense(sk.name, sk.license)"
                  @keydown.enter.prevent="openLicense(sk.name, sk.license)"
                >查看授权</span>
              </div>
            </div>
            <div v-if="assignedSkills.length === 0" :class="$style.summaryEmpty">暂无可用技能</div>
          </div>
          <template v-else>
            <div :class="$style.checkActions">
              <button
                type="button"
                role="checkbox"
                :aria-checked="allSkillsAssigned() ? 'true' : someSkillsAssigned() ? 'mixed' : 'false'"
                :class="$style.checkItem"
                :disabled="store.skills.length === 0"
                @click="toggleAllSkills(!allSkillsAssigned())"
              >
                <span :class="[$style.box, { [$style.boxChecked]: allSkillsAssigned(), [$style.boxIndet]: someSkillsAssigned() }]">
                  <MxIcon v-if="allSkillsAssigned()" name="lucide:check" :size="16" />
                  <MxIcon v-else-if="someSkillsAssigned()" name="lucide:minus" :size="16" />
                </span>
                <span :class="$style.checkLabel">全选/取消</span>
              </button>
              <span :class="$style.checkSummary">已分配 {{ localSkills.length }}/{{ store.skills.length }} 个技能</span>
            </div>
            <div :class="$style.checkList">
              <button
                v-for="sk in skillsList"
                :key="sk.origName"
                type="button"
                role="checkbox"
                :aria-checked="sk.assigned ? 'true' : 'false'"
                :class="$style.checkItem"
                @click="toggleSkill(sk.origName, !sk.assigned)"
              >
                <span :class="[$style.box, { [$style.boxChecked]: sk.assigned }]">
                  <MxIcon v-if="sk.assigned" name="lucide:check" :size="16" />
                </span>
                <span :class="$style.checkBody">
                  <span :class="$style.checkTitle">
                    {{ sk.name }}
                    <span v-if="isThirdParty(sk)" class="mx-tag" data-tone="warning">第三方</span>
                  </span>
                  <span :class="$style.checkDesc">{{ sk.desc }}</span>
                  <span :class="$style.summaryMeta">
                    <span v-if="sk.author" class="mx-tag" data-tone="neutral">{{ sk.author }}</span>
                    <span v-if="sk.version" class="mx-tag" data-tone="info">v{{ sk.version }}</span>
                    <span
                      v-if="sk.license"
                      :class="$style.licenseTag"
                      role="button"
                      tabindex="0"
                      @click.stop="openLicense(sk.origName, sk.license)"
                      @keydown.enter.prevent="openLicense(sk.origName, sk.license)"
                    >查看授权</span>
                  </span>
                </span>
              </button>
              <div v-if="store.skills.length === 0" :class="$style.summaryEmpty">暂无可用技能</div>
            </div>
          </template>
        </div>

        <!-- 区：云技能（技能连接器，勾选写入 allows_tools） -->
        <div v-show="editorTab === 'cloud'" :class="$style.tabPanel">
          <div v-if="!isEditing" :class="$style.summaryList">
            <div v-for="c in allowedConnectors" :key="c.name" :class="$style.summaryItem">
              <div :class="$style.summaryTitle">{{ c.title }} <span :class="$style.monoBadge">mcp:{{ c.name }}</span></div>
              <div :class="$style.summaryDesc">{{ c.description }}</div>
            </div>
            <div v-if="allowedConnectors.length === 0" :class="$style.summaryEmpty">尚未勾选任何云技能；点击「编辑」勾选，或到「技能连接器」开启服务</div>
          </div>
          <template v-else>
            <div :class="$style.checkList">
              <button
                v-for="c in store.connectors"
                :key="c.name"
                type="button"
                role="checkbox"
                :aria-checked="localAllowedServers.has(c.name) ? 'true' : 'false'"
                :class="$style.checkItem"
                @click="toggleConnector(c.name, !localAllowedServers.has(c.name))"
              >
                <span :class="[$style.box, { [$style.boxChecked]: localAllowedServers.has(c.name) }]">
                  <MxIcon v-if="localAllowedServers.has(c.name)" name="lucide:check" :size="16" />
                </span>
                <span :class="$style.checkBody">
                  <span :class="$style.checkTitle">{{ c.title }} <span :class="$style.monoBadge">mcp:{{ c.name }}</span></span>
                  <span :class="$style.checkDesc">{{ c.description }}</span>
                </span>
              </button>
              <div v-if="store.connectors.length === 0" :class="$style.summaryEmpty">暂无启用的技能连接器，请先到「技能连接器」中开启</div>
            </div>
            <div v-if="store.connectors.length > 0" :class="$style.checkActions">
              <button
                type="button"
                role="checkbox"
                :aria-checked="localAllowedServers.size === store.connectors.length ? 'true' : localAllowedServers.size > 0 ? 'mixed' : 'false'"
                :class="$style.checkItem"
                @click="toggleAllConnectors(localAllowedServers.size !== store.connectors.length)"
              >
                <span :class="[$style.box, { [$style.boxChecked]: localAllowedServers.size === store.connectors.length, [$style.boxIndet]: localAllowedServers.size > 0 && localAllowedServers.size < store.connectors.length }]">
                  <MxIcon v-if="localAllowedServers.size === store.connectors.length" name="lucide:check" :size="16" />
                  <MxIcon v-else-if="localAllowedServers.size > 0" name="lucide:minus" :size="16" />
                </span>
                <span :class="$style.checkLabel">全选/取消</span>
              </button>
            </div>
          </template>
        </div>

        <!-- 区：工具（基本能力，内置工具组 + 独立工具） -->
        <div v-show="editorTab === 'tools'" :class="$style.tabPanel">
          <div v-if="!isEditing" :class="$style.summaryList">
            <div v-for="g in enabledToolGroups" :key="g.key" :class="$style.summaryItem">
              <div :class="$style.summaryTitle">{{ GROUP_LABELS[g.key] }} <span :class="$style.monoBadge">{{ g.members.length }} tools</span></div>
              <div :class="$style.summaryDesc">{{ GROUP_DESCS[g.key] }}</div>
            </div>
            <div v-for="tool in enabledStandaloneTools" :key="tool.name" :class="$style.summaryItem">
              <div :class="$style.summaryTitle">{{ TOOL_LABELS[tool.name] || tool.name }}</div>
              <div :class="$style.summaryDesc">{{ TOOL_DESCS[tool.name] || tool.desc }}</div>
            </div>
            <div v-if="localEnabledTools.size === 0" :class="$style.summaryEmpty">暂无工具</div>
          </div>
          <template v-else>
            <div :class="$style.checkActions">
              <button
                type="button"
                role="checkbox"
                :aria-checked="allToolsEnabled() ? 'true' : someToolsEnabled() ? 'mixed' : 'false'"
                :class="$style.checkItem"
                @click="toggleAllTools(!allToolsEnabled())"
              >
                <span :class="[$style.box, { [$style.boxChecked]: allToolsEnabled(), [$style.boxIndet]: someToolsEnabled() }]">
                  <MxIcon v-if="allToolsEnabled()" name="lucide:check" :size="16" />
                  <MxIcon v-else-if="someToolsEnabled()" name="lucide:minus" :size="16" />
                </span>
                <span :class="$style.checkLabel">全选/取消</span>
              </button>
              <span :class="$style.checkSummary">已具有 {{ localEnabledTools.size }}/{{ AGENT_TOOLS.length }} 种基本能力</span>
            </div>
            <div :class="$style.checkList">
              <button
                v-for="item in toolsList"
                :key="item.key"
                type="button"
                role="checkbox"
                :aria-checked="item.enabled ? 'true' : item.indeterminate ? 'mixed' : 'false'"
                :class="$style.checkItem"
                @click="item.type === 'group' ? toggleGroup(item.members || [], !item.enabled) : toggleTool(item.name, !item.enabled)"
              >
                <span :class="[$style.box, { [$style.boxChecked]: item.enabled, [$style.boxIndet]: item.indeterminate }]">
                  <MxIcon v-if="item.enabled" name="lucide:check" :size="16" />
                  <MxIcon v-else-if="item.indeterminate" name="lucide:minus" :size="16" />
                </span>
                <span :class="$style.checkBody">
                  <span :class="$style.checkTitle">
                    {{ item.label }}
                    <span :class="$style.monoBadge">{{ item.type === 'group' ? (item.key === 'task' ? 'Tasks' : 'Teams') : item.name }}</span>
                  </span>
                  <span :class="$style.checkDesc">{{ item.desc }}</span>
                </span>
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- ── 市场视图（agent 类型分发包货架） ── -->
    <template v-else>
      <p v-if="store.marketLoading && !store.marketLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载市场清单…</p>
      <div v-else-if="marketCards.length > 0" :class="$style.grid">
        <div
          v-for="pkg in marketCards"
          :key="pkg.name"
          role="button"
          tabindex="0"
          :class="$style.card"
          @click="openZoomMarket(pkg, $event)"
          @keydown.enter.prevent="openZoomMarket(pkg, $event)"
        >
          <div :class="$style.cardTop">
            <img
              v-if="pkg.icon"
              :class="[$style.avatar, $style.avatarImg]"
              :src="pkg.icon"
              :alt="marketPkgDisplayName(pkg)"
            />
            <span v-else :class="$style.avatar">{{ (marketPkgDisplayName(pkg) || '?').charAt(0).toUpperCase() }}</span>
            <div :class="$style.titleCol">
              <span :class="$style.name" :title="pkg.name">{{ marketPkgDisplayName(pkg) }}</span>
              <span v-if="marketPkgRoleSubtitle(pkg)" :class="$style.sub">{{ marketPkgRoleSubtitle(pkg) }}</span>
            </div>
            <!-- 招募/散伙动作上移至右上角取代状态标签（与团队卡片同款） -->
            <button
              v-if="!hiredNames.has(pkg.name)"
              type="button"
              class="mx-btn mx-btn--primary"
              :disabled="store.installing === pkg.name"
              @click.stop="onRecruit(pkg)"
            >
              {{ store.installing === pkg.name ? '招募中…' : '招募' }}
            </button>
            <button
              v-else
              type="button"
              class="mx-btn"
              :disabled="store.operating === pkg.name || !canFire"
              :title="!canFire ? '系统至少需要保留一个智能体' : undefined"
              @click.stop="onMarketFire(pkg)"
            >
              <span v-if="store.operating === pkg.name" class="mx-text-loading">执行中…</span>
              <template v-else>散伙</template>
            </button>
          </div>
          <p :class="$style.desc" :title="pkg.description">{{ pkg.description || '暂无描述' }}</p>
          <div :class="$style.tagRow">
            <span v-if="(pkg.category || '').trim()" class="mx-tag" data-tone="info">{{ (pkg.category || '').trim() }}</span>
            <span v-if="(pkg.skills || []).length" class="mx-tag" data-tone="warning">{{ (pkg.skills || []).length }} 个技能</span>
          </div>
        </div>
      </div>
      <p v-else-if="store.marketLoaded" :class="$style.hint">市场暂无可安装的智能体</p>
      <p v-else :class="$style.hint">市场清单加载失败，请点击刷新重试</p>
    </template>

    <!-- ── 市场详情弹层：FLIP 分段动效（ghost 卡片拉宽→拉高），到位即呈现 ── -->
    <Teleport to="body">
      <div
        v-if="zoomed"
        :class="[$style.zoomBackdrop, { [$style.zoomPreparing]: zoomPreparing, [$style.zoomClosing]: zoomClosing }]"
        @click="closeZoom"
      >
        <div
          ref="zoomCardRef"
          :class="[$style.zoomCard, { [$style.zoomPreparing]: zoomPreparing, [$style.zoomClosing]: zoomClosing }]"
          @click.stop
        >
          <!-- 头部卡：头像 + 展示名 + 元信息 + 招募操作 + 简介 -->
          <div :class="$style.cardTop">
            <img
              v-if="zoomed.pkg.icon"
              :class="[$style.zoomAvatar, $style.avatarImg]"
              :src="zoomed.pkg.icon"
              :alt="zoomed.title"
            />
            <span v-else :class="$style.zoomAvatar">{{ (zoomed.title || '?').charAt(0).toUpperCase() }}</span>
            <div :class="$style.titleCol">
              <span :class="$style.name">{{ zoomed.title }}</span>
              <span v-if="marketPkgRoleSubtitle(zoomed.pkg)" :class="$style.sub">{{ marketPkgRoleSubtitle(zoomed.pkg) }}</span>
            </div>
            <span
              class="mx-tag"
              :data-tone="zoomed.hired ? 'success' : zoomed.installed ? 'info' : 'warning'"
            >
              {{ zoomed.hired ? '已招募' : zoomed.installed ? '未招募' : '未安装' }}
            </span>
          </div>
          <div :class="$style.tagRow">
            <span v-if="zoomed.category" class="mx-tag" data-tone="info">{{ zoomed.category }}</span>
            <span v-if="zoomed.version" class="mx-tag" data-tone="neutral">版本 {{ zoomed.version }}</span>
          </div>
          <p :class="$style.zoomDesc">{{ zoomed.description }}</p>

          <!-- 技能装备清单：头部与底栏钉住，仅清单滚动 -->
          <div :class="$style.zoomContent">
            <div :class="$style.sectionTitle">
              技能装备
              <span :class="$style.skillCount">{{ zoomed.skillItems.length }} 个技能</span>
            </div>
            <div v-if="zoomed.skillItems.length > 0" :class="$style.skillList">
              <div v-for="s in zoomed.skillItems" :key="s.name" :class="$style.skillItem">
                <div :class="$style.skillHead">
                  <span :class="$style.skillName">{{ s.nameZh }}</span>
                  <span v-if="s.version" class="mx-tag" data-tone="info">v{{ s.version }}</span>
                </div>
                <p :class="[$style.summaryDesc, { [$style.descEmpty]: !s.desc }]">{{ s.desc || '暂无技能描述' }}</p>
              </div>
            </div>
            <p v-else :class="$style.hint">该智能体暂未装配技能</p>
          </div>

          <div :class="$style.cardFoot" @click.stop>
            <span></span>
            <div :class="$style.cardActions">
              <button
                v-if="!zoomed.hired"
                type="button"
                class="mx-btn mx-btn--primary"
                :disabled="store.installing === zoomed.name"
                @click="recruitFromZoom(zoomed)"
              >
                {{ store.installing === zoomed.name ? '招募中…' : '招募' }}
              </button>
              <button
                v-else
                type="button"
                class="mx-btn"
                :disabled="store.operating === zoomed.name || !canFire"
                :title="!canFire ? '系统至少需要保留一个智能体' : undefined"
                @click="fireFromZoom(zoomed)"
              >
                <span v-if="store.operating === zoomed.name" class="mx-text-loading">执行中…</span>
                <template v-else>散伙</template>
              </button>
              <button type="button" class="mx-btn" :class="$style.zoomClose" @click="closeZoom">关闭</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 组队对话框（Teleport 到 body）：队名输入框 +「+」添加成员 + 成员头像堆叠预览 -->
    <Teleport to="body">
      <div v-if="teamModalOpen" :class="$style.teamModalMask" @click.self="teamModalOpen = false">
        <div :class="$style.teamModal">
          <h3 :class="$style.teamModalTitle">组队</h3>
          <input
            v-model="teamNameDraft"
            :class="$style.teamModalName"
            placeholder="队名"
            @keydown.enter.prevent="saveTeam"
          />
          <div :class="$style.teamModalRow">
            <div :class="$style.teamModalPickerWrap">
              <button
                type="button"
                :class="$style.teamModalAdd"
                title="添加成员"
                @click="memberPickerOpen = !memberPickerOpen"
              >
                +
              </button>
              <!-- 成员选择浮层（多选，确定并入草稿名单） -->
              <div v-if="memberPickerOpen" :class="$style.memberPicker">
                <label v-for="m in hireableMembers" :key="m.name" :class="$style.memberItem">
                  <input v-model="memberPicks" type="checkbox" :value="m.name" />
                  <img v-if="m.icon" :class="$style.teamStackAvatar" :src="m.icon" :alt="agentDisplayName(m)" />
                  <span>{{ agentDisplayName(m) }}</span>
                </label>
                <p v-if="hireableMembers.length === 0" :class="$style.hint">暂无其他已招募成员</p>
                <div :class="$style.memberPickerFoot">
                  <button type="button" class="mx-btn" @click="memberPickerOpen = false">取消</button>
                  <button type="button" class="mx-btn mx-btn--primary" @click="confirmPicks">确定</button>
                </div>
              </div>
            </div>
            <!-- 成员头像堆叠（草稿预览：前一个覆盖后一个左边一半） -->
            <div v-if="draftMemberAvatars.length" :class="$style.teamStack" title="团队成员">
              <template v-for="m in draftMemberAvatars" :key="m.name">
                <img v-if="m.icon" :class="$style.teamStackAvatar" :src="m.icon" :alt="m.displayName" :title="m.displayName" />
                <span v-else :class="$style.teamStackAvatar" :title="m.displayName">{{ m.displayName.charAt(0).toUpperCase() }}</span>
              </template>
            </div>
          </div>
          <div :class="$style.teamModalFoot">
            <button type="button" class="mx-btn" @click="teamModalOpen = false">取消</button>
            <button type="button" class="mx-btn mx-btn--primary" @click="saveTeam">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-4) 0;
}

.sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.headText {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.sectionTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.sectionHint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 页签行：页签组独占一行且水平居中 */
.tabsRow {
  display: flex;
  justify-content: center;
}

/* 分段页签指示器：与 skills 管理行同款（此前裸 span 无样式，选中态不可见） */
.tabsIndicator {
  position: absolute;
  inset: 4px auto 4px 4px;
  box-sizing: border-box;
  border: 0.5px solid var(--mx-border-strong);
  border-radius: 8px;
  background: var(--mx-bg-elevated);
  transition:
    transform 180ms ease,
    width 180ms ease;
  pointer-events: none;
}

/* 视图页签：两档等宽（grid 1fr 平分），indicator 与 .mx-tabs-indicator 同几何 */
.viewTabs {
  flex: none;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

.viewTabs :global(.mx-tab) {
  white-space: nowrap;
}

.search {
  width: 100%;
}

.warning {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-warn-label);
}

/* 分类标签行：胶囊小钮，选中态 accent 描边 */
.domains {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-wrap: wrap;
}

.domainTag {
  height: 24px;
  padding: 0 12px;
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: 999px;
  background: var(--mx-module);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  cursor: pointer;
  transition:
    border-color var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.domainTag:hover {
  border-color: var(--mx-border-strong);
}

.domainTag:active {
  background: var(--mx-active);
}

.domainTag:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.domainTag[aria-pressed='true'] {
  border-color: var(--mx-accent);
  color: var(--mx-accent);
}

/* 卡片网格：自适应列宽（与技能/连接器同布局口径）；
   团队网格限高内滚，保证下方配置面板（上下结构的"下"）始终在视口内 */
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mx-space-3);
  align-content: start;
  /* 卡片高度随内容自适应（不随行内最高卡片拉伸） */
  align-items: start;
  max-height: 46vh;
  overflow-y: auto;
  padding: 2px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition:
    border-color var(--mx-duration-fast) var(--mx-ease-standard),
    transform 300ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.card:hover {
  border-color: var(--mx-border-selected);
  transform: translateY(-2px);
  box-shadow: var(--mx-shadow-panel);
}

.card:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

/* 团队迷你卡横排（供应商品牌卡同款）：一行滚动，点击在下方配置面板展开 */
.strip {
  display: flex;
  gap: var(--mx-space-2);
  overflow-x: auto;
  padding: 2px;
  /* 隐藏水平滚动条（保留滚轮/触控板横向滚动） */
  scrollbar-width: none;
}

.strip::-webkit-scrollbar {
  display: none;
}

.mCard {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  box-sizing: border-box;
  padding: var(--mx-space-2) var(--mx-space-3);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

/* 选中员工：accent 描边（配置面板数据源指示） */
.mCard[data-active='true'] {
  border-color: var(--mx-accent);
  background: var(--mx-hover);
}

.mCard:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.mAvatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--mx-module);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

/* 头像图片：与各尺寸头像类组合使用，图片填满圆角容器 */
.avatarImg {
  object-fit: cover;
  background: var(--mx-module);
}

.mName {
  min-width: 0;
  max-width: 120px;
  font: var(--mx-font-body);
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 迷你卡副题小字（Role）：昵称后同行展示 */
.mRole {
  flex: none;
  max-width: 96px;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mTags {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.cardTop {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--mx-module);
  font: var(--mx-font-heading);
  color: var(--mx-text-secondary);
}

.titleCol {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 副题小字（Role）：统一显示规则 = 昵称主名 + Role 小字 */
.sub {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.desc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.tagRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-wrap: wrap;
}

.cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-1);
  margin-top: auto;
}

.cardActions {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.emptyBox {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-5) 0;
}

.hint {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}

/* ── 下方配置面板 ── */
.config {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3);
  background: var(--mx-bg-elevated);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
}

.cfgHead {
  display: flex;
  align-items: flex-start;
  gap: var(--mx-space-3);
  padding-bottom: var(--mx-space-3);
  border-bottom: 0.5px solid var(--mx-separator-soft);
}

.cfgAvatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--mx-module);
  font: var(--mx-font-heading);
  color: var(--mx-text-secondary);
}

.cfgMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cfgNameRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.cfgName {
  margin: 0;
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

/* 配置面板副题小字（Role）：昵称后同行展示 */
.cfgRole {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
}

.cfgId {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 标识行可编辑态：悬浮提示可点（虚线下划线），点击进入昵称编辑 */
.cfgIdEditable {
  cursor: pointer;
  text-decoration: underline dashed color-mix(in srgb, var(--mx-text-tertiary) 55%, transparent);
  text-underline-offset: 3px;
}

.cfgIdEditable:hover {
  color: var(--mx-text-secondary);
}

/* 编辑态输入框：沿用标识行字形，仅保留底边线（对齐 inline 编辑惯例） */
input.cfgId {
  width: 160px;
  padding: 0 var(--mx-space-1);
  border: none;
  border-bottom: 1px solid var(--mx-accent);
  background: transparent;
  outline: none;
  color: var(--mx-text);
}

/* 成员选择浮层（组队对话框内下拉） */
.memberPicker {
  position: absolute;
  top: calc(100% + var(--mx-space-1));
  left: 0;
  z-index: 30;
  width: 240px;
  max-height: 240px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  background: var(--mx-menu-bg);
  border: 1px solid var(--mx-separator);
  box-shadow: var(--mx-shadow-prominent);
}

.memberPickerFoot {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-1);
}

/* 团队成员头像堆叠：紧密排列，前一个覆盖后一个左边一半（负 margin 叠加） */
.teamStack {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-right: var(--mx-space-2);
}

.teamStackAvatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--mx-bg-elevated);
  background: var(--mx-hover);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.teamStack > * + * {
  margin-left: -12px;
}

/* 组队对话框（Teleport 到 body）：队名 + 添加成员 + 头像预览 */
.teamModalMask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mx-mask);
}

.teamModal {
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-4);
  border-radius: var(--mx-radius-window);
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  box-shadow: var(--mx-shadow-panel);
}

.teamModalTitle {
  margin: 0;
  font: var(--mx-font-heading);
  font-weight: 600;
  color: var(--mx-text);
}

.teamModalName {
  width: 100%;
  padding: var(--mx-space-2);
  border: 1px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: var(--mx-bg-surface);
  font: var(--mx-font-body);
  color: var(--mx-text);
  outline: none;
}

.teamModalName:focus {
  border-color: var(--mx-accent);
}

.teamModalRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  min-height: 32px;
}

.teamModalPickerWrap {
  position: relative;
  flex-shrink: 0;
}

.teamModalAdd {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px dashed var(--mx-border-strong);
  background: var(--mx-bg-surface);
  color: var(--mx-text-secondary);
  font: var(--mx-font-body);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.teamModalAdd:hover {
  color: var(--mx-accent);
  border-color: var(--mx-accent);
}

.teamModalFoot {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}

/* 成员选择浮层内的成员行 */
.memberItem {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  color: var(--mx-text);
  cursor: pointer;
}

.cfgDesc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.cfgTabsRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.cfgTabs {
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

.cfgActions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.tabPanel {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

/* 指令区：chips 切换 + textarea */
.chipRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.chip {
  height: 24px;
  padding: 0 12px;
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: 999px;
  background: var(--mx-module);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  cursor: pointer;
  transition:
    border-color var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.chip:hover {
  border-color: var(--mx-border-strong);
}

.chip:active {
  background: var(--mx-active);
}

.chip:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.chip[aria-pressed='true'] {
  border-color: var(--mx-accent);
  color: var(--mx-accent);
}

.instructionBlock {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.area {
  box-sizing: border-box;
  width: 100%;
  min-height: 160px;
  resize: vertical;
  padding: 8px 10px;
  background: var(--mx-module);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  font: var(--mx-font-body);
  line-height: 1.6;
  color: var(--mx-text);
  transition: border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.area::placeholder {
  color: var(--mx-text-tertiary);
}

.area:focus {
  outline: none;
  border-color: var(--mx-accent);
}

.instructionFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

/* 查看态摘要 */
.summaryList {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.summaryItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--mx-space-2) var(--mx-space-3);
  background: var(--mx-module);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
}

.summaryTitle {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.monoBadge {
  font-family: var(--mx-font-family);
  font-size: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  padding: 0 6px;
  border-radius: 4px;
  line-height: 1.6;
}

.summaryDesc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.descEmpty {
  color: var(--mx-text-tertiary);
}

.summaryMeta {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-wrap: wrap;
}

.summaryEmpty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}

/* 许可证 tag 可点击打开阅读器 */
.licenseTag {
  font: var(--mx-font-caption);
  color: var(--mx-accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* ── 勾选列表（编辑态） ── */
.checkActions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  background: var(--mx-module);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
}

.checkSummary {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.checkList {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
}

.checkItem {
  display: flex;
  align-items: flex-start;
  gap: var(--mx-space-2);
  width: 100%;
  box-sizing: border-box;
  padding: var(--mx-space-2) var(--mx-space-3);
  background: transparent;
  border: none;
  border-bottom: 0.5px solid var(--mx-separator-soft);
  cursor: pointer;
  text-align: left;
  transition: background var(--mx-duration-fast) var(--mx-ease-standard);
}

.checkItem:last-child {
  border-bottom: none;
}

.checkItem:hover {
  background: var(--mx-active);
}

.checkItem:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: -2px;
}

.checkItem:disabled {
  cursor: default;
  opacity: 0.5;
}

.box {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border: 0.5px solid var(--mx-border-strong);
  border-radius: 5px;
  background: var(--mx-bg-surface);
  color: var(--mx-bg-elevated);
  transition:
    background var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.boxChecked {
  background: var(--mx-accent);
  border-color: var(--mx-accent);
}

.boxIndet {
  border-color: var(--mx-accent);
  color: var(--mx-accent);
}

.checkLabel {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.checkBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.checkTitle {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.checkDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
  white-space: pre-line;
  word-break: break-word;
}

/* ── 详情弹层：FLIP 分段动效由 ghost 元素承担（WAAPI transform），弹层仅退场做透明度过渡；
      不用 backdrop-filter——大面积实时模糊是此前弹层卡顿的根源，纯色压暗即可 ── */
/* 遮罩入场即时呈现（无透明度过渡——ghost 落位即全量显示，无"模糊到显示"尾段）；
   仅退场走淡出 */
.zoomBackdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mx-mask);
  opacity: 1;
}

.zoomBackdrop.zoomPreparing {
  opacity: 0;
  transition: none;
}

.zoomBackdrop.zoomClosing {
  opacity: 0;
  transition: opacity 160ms ease;
}

.zoomCard {
  /* 固定尺寸：ghost 落点矩形确定，内容不跳动 */
  width: min(880px, 92vw);
  height: min(84vh, 780px);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-4);
  box-sizing: border-box;
  border-radius: var(--mx-radius-window);
  background: var(--mx-bg-elevated);
  border: 0.5px solid var(--mx-separator-soft);
  box-shadow: var(--mx-shadow-prominent);
  /* 入场不做透明度过渡：ghost 落位瞬间弹层立即不透明换位，避免落位矩形出现空隙；
     仅退场走淡出（退场时 ghost 已盖住矩形，淡出不可见，双保险） */
  opacity: 1;
  transition: none;
}

.zoomCard.zoomPreparing {
  opacity: 0;
}

.zoomCard.zoomClosing {
  opacity: 0;
  transition: opacity 160ms ease;
}

.zoomAvatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--mx-module);
  font: var(--mx-font-heading);
  color: var(--mx-text-secondary);
}

.zoomDesc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.7;
  word-break: break-word;
  white-space: pre-wrap;
}

/* 内容区：分隔线之上为头部（标题+描述）；头部与底栏钉住，仅清单滚动 */
.zoomContent {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  border-top: 0.5px solid var(--mx-separator);
  padding-top: var(--mx-space-2);
  padding-right: var(--mx-space-1);
}

.sectionTitle {
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.skillCount {
  font: var(--mx-font-caption);
  font-weight: 400;
  color: var(--mx-text-tertiary);
}

.skillList {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.skillItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--mx-space-2) var(--mx-space-3);
  background: var(--mx-module);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
}

.skillHead {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.skillName {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.zoomClose {
  margin-left: var(--mx-space-2);
}
</style>
