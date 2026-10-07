<script setup lang="ts">
/**
 * 团队管理行："团队"设置页唯一自定义行，承载完整管理器（skills 管理行先例）。
 * 布局为上下结构（桌面端左右结构移植改形）：
 * 上 = 顶部「成员 | 团队」分段切换 + 选中对象卡片横排（strip），
 * 下 = 选中对象的配置面板（头部 + 指令/技能/云技能/工具四区；团队为档案/成员页签）。
 * 许可证走壳 Overlay modal。
 */
import { computed, nextTick, onMounted, ref, useCssModule, watch } from 'vue'
import type { Component } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import {
  useAgentsStore,
  agentDisplayName,
  agentRoleSubtitle,
  skillDisplayName,
  skillLocaleDesc,
  teamDisplayName,
} from '../store'
import { pushNotice } from '../notice'
import { MODAL_AGENTS_LICENSE } from '../ids'
import MetricRateButtons from './MetricRateButtons.vue'
import LicenseModal from '../overlays/LicenseModal.vue'
import TeamEditorModal from './TeamEditorModal.vue'
import type { AgentMeta, SkillInfo, TeamMeta, TeamUpdateParams } from '../types'
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
    pushNotice(shell, 'error', err instanceof Error ? err.message : '智能体列表加载失败，请检查与智能主机的连接')
  })
  // 团队清单（配置头部团队标识/成员堆叠与 TeamEditorModal 数据源；失败仅降级为无团队态）
  store.loadTeams().catch(() => {})
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

function openLicense(name: string, content: string): void {
  store.openLicense(`许可证 — ${name}`, content)
  openModal(MODAL_AGENTS_LICENSE, LicenseModal)
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

// ── 团队选中态：与成员同 strip 混排、同配置面板骨架（页签为团队档案 / 成员） ──
const selectedKind = ref<'agent' | 'team'>('agent')
const selectedTeamName = ref('')
const selectedTeam = computed<TeamMeta | null>(
  () => store.teams.find((t) => t.name === selectedTeamName.value) || null,
)

function selectAgentCard(name: string): void {
  selectedKind.value = 'agent'
  selectedName.value = name
}

function selectTeamCard(name: string): void {
  selectedKind.value = 'team'
  selectedTeamName.value = name
  teamEditorTab.value = 'profile'
  cancelTeamEditing()
}

// ── 团队雇佣 / 解雇（原团队招聘区逻辑并入；通知范式同区） ──
function onTeamHire(t: TeamMeta): void {
  store
    .hireTeam(t.name)
    .then(() => pushNotice(shell, 'success', `已雇佣团队「${teamDisplayName(t)}」`))
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
    })
}

function onTeamFire(t: TeamMeta): void {
  store
    .fireTeam(t.name)
    .then(() => pushNotice(shell, 'success', `已解雇团队「${teamDisplayName(t)}」`))
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
    })
}

/** 负责人展示名（Agent 名 → 昵称/角色回退原名） */
function leaderLabel(name: string): string {
  const a = store.agents.find((x) => x.name === name)
  return a ? agentDisplayName(a) : name
}

// ── 团队配置编辑态（只读展示 ↔ 编辑表单双态，与成员配置的编辑/完成同心智） ──
const teamEditorTab = ref<'profile' | 'members'>('profile')
const isTeamEditing = ref(false)
const teamSaving = ref(false)
const teamForm = ref({
  nick_name: '',
  description: '',
  category: '',
  profile: '',
  leader: '',
  members: [] as string[],
})

function startTeamEditing(): void {
  const t = selectedTeam.value
  if (!t) return
  teamForm.value = {
    nick_name: t.nick_name || '',
    description: t.description || '',
    category: t.category || '',
    profile: t.profile || '',
    leader: t.leader || '',
    members: [...(t.members || [])]
  }
  isTeamEditing.value = true
}

function cancelTeamEditing(): void {
  isTeamEditing.value = false
}

/** 保存团队编辑：team.update 指针语义，仅传变化字段 */
function saveTeamEdits(): void {
  const t = selectedTeam.value
  if (!t) return
  const patch: TeamUpdateParams = { name: t.name }
  const cur = {
    nick_name: t.nick_name || '',
    description: t.description || '',
    category: t.category || '',
    profile: t.profile || '',
    leader: t.leader || '',
    members: t.members || []
  }
  const next = {
    ...teamForm.value,
    nick_name: teamForm.value.nick_name.trim(),
    category: teamForm.value.category.trim()
  }
  for (const key of ['nick_name', 'description', 'category', 'profile', 'leader'] as const) {
    if (next[key] !== cur[key]) patch[key] = next[key]
  }
  if (JSON.stringify(next.members) !== JSON.stringify(cur.members)) patch.members = next.members
  if (Object.keys(patch).length === 1) {
    isTeamEditing.value = false
    return
  }
  teamSaving.value = true
  store
    .updateTeam(patch)
    .then(() => {
      isTeamEditing.value = false
      pushNotice(shell, 'success', `已保存团队「${teamDisplayName(t)}」`)
    })
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
    })
    .finally(() => {
      teamSaving.value = false
    })
}

/** 可选负责人/成员（已注册 Agent；daemon 侧校验存在性） */
const agentOptions = computed(() =>
  store.agents.map((a) => ({ name: a.name, label: agentDisplayName(a) })),
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
const editorTab = ref<'instructions' | 'skills' | 'cloud' | 'tools'>('instructions')
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
const detailLoading = ref(false)
/** 请求序号：快速切换员工时丢弃过期响应 */
let detailReqSeq = 0

async function loadAgentBodies(name: string): Promise<void> {
  const seq = ++detailReqSeq
  identityBody.value = ''
  soulBody.value = ''
  identityDirty.value = false
  soulDirty.value = false
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

// ── 指令保存（身份写 identity_body，行为准则写 soul；独立于全局编辑态） ──
async function saveBody(section: 'identity' | 'soul'): Promise<void> {
  const name = selectedName.value
  if (!name) return
  const field = section === 'identity' ? 'identity_body' : 'soul'
  const value = section === 'identity' ? identityBody.value : soulBody.value
  try {
    await store.updateAgent({ name, [field]: value })
    if (section === 'identity') identityDirty.value = false
    else soulDirty.value = false
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

// ── 团队（配置头部）：成员头像堆叠与「管理团队」入口基于一等 Team 实体
// （team.list，leader === 当前员工的团队）；非负责人行不再提供组队入口 ──
interface TeamStackAvatar {
  name: string
  displayName: string
  icon?: string
}

/** 当前员工负责的团队（team.list 口径；无则为 null） */
const leaderTeam = computed(() => store.teams.find((t) => t.leader === selectedAgent.value?.name) || null)

const teamMemberAvatars = computed<TeamStackAvatar[]>(() => {
  const team = leaderTeam.value
  if (!team) return []
  return (team.members || [])
    .map((name) => {
      const meta = store.agents.find((a) => a.name === name)
      return { name, displayName: meta ? agentDisplayName(meta) : name, icon: meta?.icon }
    })
    .filter((m) => !!m)
})

// ── 散伙（成员卡片配置面板头部共用） ──
function onFire(name: string, display: string): void {
  store
    .fire(name)
    .then(() => pushNotice(shell, 'success', `已散伙「${display}」，将不再用于新会话`))
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
    })
}

// ── 分段页签指示器（.mx-tabs 指示器位移经 JS 写 transform；分段切换 + 配置区页签两处） ──
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

watch(selectedKind, () => void nextTick(() => syncIndicator(viewTabsRef.value)))
watch(editorTab, () => void nextTick(() => syncIndicator(configTabsRef.value)))
// 团队页签切换与团队清单变化：指示器同步；选中团队被删除时回落到首个已招募成员
watch(teamEditorTab, () => void nextTick(() => syncIndicator(configTabsRef.value)))
watch(
  () => store.teams,
  (list) => {
    if (selectedKind.value !== 'team') return
    if (list.some((t) => t.name === selectedTeamName.value)) return
    selectedTeamName.value = ''
    selectedKind.value = 'agent'
    const first = store.hiredAgents[0]
    if (first) selectedName.value = first.name
  },
)
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
        <span :class="$style.sectionHint">配置员工的基本能力与技能；点击卡片在下方展开配置</span>
      </div>
    </div>

    <!-- 工具栏：「成员 | 团队」分段切换独占一行居中（右端"新建团队"入口），搜索独占一行全宽 -->
    <div :class="$style.tabsRow">
      <div ref="viewTabsRef" class="mx-tabs" :class="$style.viewTabs">
        <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
        <button type="button" class="mx-tab" role="tab" :aria-selected="selectedKind === 'agent' ? 'true' : 'false'" @click="selectedKind = 'agent'">
          成员
        </button>
        <button type="button" class="mx-tab" role="tab" :aria-selected="selectedKind === 'team' ? 'true' : 'false'" @click="selectedKind = 'team'">
          团队
        </button>
      </div>
      <button
        type="button"
        class="mx-btn mx-btn--primary"
        :class="$style.tabsNewTeam"
        @click="store.openTeamEditor('create')"
      >
        新建团队
      </button>
    </div>
    <input
      v-model="search"
      class="mx-input"
      :class="$style.search"
      placeholder="搜索名称、角色或描述"
    />

    <!-- ── 成员与团队迷你卡横排（供应商品牌卡同款）；下：选中对象配置面板 ── -->
    <p v-if="store.loading && !store.loaded" :class="[$style.hint, 'mx-text-loading']">正在加载员工清单…</p>
    <div v-else-if="teamCards.length > 0 || store.teams.length > 0" :class="$style.strip">
      <div
        v-for="a in teamCards"
        v-if="selectedKind === 'agent'"
        :key="a.name"
        role="button"
        tabindex="0"
        :class="$style.mCard"
        :data-active="selectedKind === 'agent' && a.name === selectedName ? 'true' : 'false'"
        @click="selectAgentCard(a.name)"
        @keydown.enter.prevent="selectAgentCard(a.name)"
      >
        <img v-if="a.icon" :class="[$style.mAvatar, $style.avatarImg]" :src="a.icon" :alt="agentDisplayName(a)" />
        <span v-else :class="$style.mAvatar">{{ (agentDisplayName(a) || '?').charAt(0).toUpperCase() }}</span>
        <span :class="$style.mName" :title="a.name">{{ agentDisplayName(a) }}</span>
        <span v-if="agentRoleSubtitle(a)" :class="$style.mRole">{{ agentRoleSubtitle(a) }}</span>
        <!-- 分类与统计标签：挪到卡片右端（原散伙按钮位）；散伙入口收进配置面板头部 -->
        <div :class="$style.mTags">
          <span v-if="(a.category || '').trim()" class="mx-tag" data-tone="info">{{ (a.category || '').trim() }}</span>
          <span v-if="ratingsOf(a) > 0" class="mx-tag" data-tone="neutral">★ {{ ratingsOf(a) }}</span>
          <span v-if="(a.skills || []).length" class="mx-tag" data-tone="warning">{{ (a.skills || []).length }} 个技能</span>
        </div>
      </div>

      <!-- 团队卡：与成员迷你卡同样式，「团队」徽标 + 成员数区分 -->
      <div
        v-for="t in store.teams"
        v-else-if="selectedKind === 'team'"
        :key="'team:' + t.name"
        role="button"
        tabindex="0"
        :class="$style.mCard"
        :data-active="selectedKind === 'team' && t.name === selectedTeamName ? 'true' : 'false'"
        @click="selectTeamCard(t.name)"
        @keydown.enter.prevent="selectTeamCard(t.name)"
      >
        <img v-if="t.icon" :class="[$style.mAvatar, $style.avatarImg]" :src="t.icon" :alt="teamDisplayName(t)" />
        <span v-else :class="$style.mAvatar">{{ (teamDisplayName(t) || '?').charAt(0).toUpperCase() }}</span>
        <span :class="$style.mName" :title="t.name">{{ teamDisplayName(t) }}</span>
        <span :class="$style.mRole">{{ t.name }}</span>
        <div :class="$style.mTags">
          <span class="mx-tag" data-tone="warning">团队</span>
          <span class="mx-tag" data-tone="neutral">{{ (t.members || []).length }} 名成员</span>
        </div>
      </div>
    </div>
    <div v-else :class="$style.emptyBox">
      <p :class="$style.hint">团队里还没有智能体</p>
    </div>

      <!-- ── 下方配置面板（团队）：与成员配置同骨架，页签为「团队档案 / 成员」 ── -->
      <div v-if="selectedKind === 'team' && selectedTeam" :class="$style.config">
        <!-- 头部：头像 + 团队名 + 雇佣标签 + 描述 + 操作（雇佣/解雇/编辑） -->
        <div :class="$style.cfgHead">
          <img
            v-if="selectedTeam.icon"
            :class="[$style.cfgAvatar, $style.avatarImg]"
            :src="selectedTeam.icon"
            :alt="teamDisplayName(selectedTeam)"
          />
          <span v-else :class="$style.cfgAvatar">{{ (teamDisplayName(selectedTeam) || '?').charAt(0).toUpperCase() }}</span>
          <div :class="$style.cfgMain">
            <div :class="$style.cfgNameRow">
              <h3 :class="$style.cfgName">{{ teamDisplayName(selectedTeam) }}</h3>
              <span class="mx-tag" :data-tone="selectedTeam.hired ? 'success' : 'warning'">
                {{ selectedTeam.hired ? '已雇佣' : '未雇佣' }}
              </span>
              <!-- 决策计量：团队整体评价双指（agent.rate subject_type=team） -->
              <MetricRateButtons subject-type="team" :name="selectedTeam.name" />
            </div>
            <span :class="$style.cfgRole">{{ selectedTeam.name }}</span>
            <p :class="$style.cfgDesc">{{ selectedTeam.description || '暂无描述' }}</p>
          </div>
          <div :class="$style.cfgActions">
            <button
              v-if="!selectedTeam.hired"
              type="button"
              class="mx-btn mx-btn--primary"
              :disabled="store.teamOperating === selectedTeam.name"
              @click="onTeamHire(selectedTeam)"
            >
              <span v-if="store.teamOperating === selectedTeam.name" class="mx-text-loading">执行中…</span>
              <template v-else>雇佣</template>
            </button>
            <button
              v-else
              type="button"
              class="mx-btn"
              :disabled="store.teamOperating === selectedTeam.name"
              @click="onTeamFire(selectedTeam)"
            >
              <span v-if="store.teamOperating === selectedTeam.name" class="mx-text-loading">执行中…</span>
              <template v-else>解雇</template>
            </button>
            <button type="button" class="mx-btn" @click="store.openTeamEditor('edit', selectedTeam.name)">编辑</button>
          </div>
        </div>

        <!-- 页签（分段指示器同款）：团队档案 / 成员 -->
        <div ref="configTabsRef" class="mx-tabs" :class="$style.cfgTabs">
          <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
          <button type="button" class="mx-tab" role="tab" :aria-selected="teamEditorTab === 'profile' ? 'true' : 'false'" @click="teamEditorTab = 'profile'">
            团队档案
          </button>
          <button type="button" class="mx-tab" role="tab" :aria-selected="teamEditorTab === 'members' ? 'true' : 'false'" @click="teamEditorTab = 'members'">
            成员
          </button>
        </div>

        <!-- 团队档案（只读展示：描述 + Profile 正文预览） -->
        <div v-if="teamEditorTab === 'profile'" :class="$style.teamReadView">
          <div :class="$style.teamReadBlock">
            <span :class="$style.teamReadLabel">分类</span>
            <span :class="$style.teamReadValue">{{ selectedTeam.category || '暂无分类' }}</span>
          </div>
          <div :class="$style.teamReadBlock">
            <span :class="$style.teamReadLabel">团队 Profile</span>
            <p :class="$style.teamProfilePreview">{{ selectedTeam.profile || '暂无内容（保存后写入 TEAM.md 正文，团队会话中原样注入）' }}</p>
          </div>
          <div :class="$style.teamReadActions">
            <button type="button" class="mx-btn mx-btn--primary" @click="startTeamEditing()">编辑</button>
          </div>
        </div>

        <!-- 成员（只读展示：负责人 + 成员清单） -->
        <div v-else :class="$style.teamReadView">
          <div :class="$style.teamReadBlock">
            <span :class="$style.teamReadLabel">负责人</span>
            <span :class="$style.teamReadValue">{{ leaderLabel(selectedTeam.leader) }}</span>
          </div>
          <div :class="$style.teamReadBlock">
            <span :class="$style.teamReadLabel">成员清单</span>
            <div :class="$style.teamMemberList">
              <span v-for="m in selectedTeam.members || []" :key="m" class="mx-tag" data-tone="neutral">{{ leaderLabel(m) }}</span>
              <span v-if="!(selectedTeam.members || []).length" :class="$style.teamReadValue">尚未任命成员</span>
            </div>
          </div>
          <div :class="$style.teamReadActions">
            <button type="button" class="mx-btn mx-btn--primary" @click="startTeamEditing()">编辑</button>
          </div>
        </div>

        <!-- 编辑表单（team.update 指针语义，仅传变化字段） -->
        <template v-if="isTeamEditing">
          <div v-if="teamEditorTab === 'profile'" :class="$style.teamEditForm">
            <label :class="$style.teamFieldRow">
              <span :class="$style.teamFieldLabel">昵称</span>
              <input v-model="teamForm.nick_name" class="mx-input" placeholder="两三字外号（展示主名）" />
            </label>
            <label :class="$style.teamFieldRow">
              <span :class="$style.teamFieldLabel">分类</span>
              <input v-model="teamForm.category" class="mx-input" placeholder="中文业务分类" />
            </label>
            <label :class="$style.teamFieldRow">
              <span :class="$style.teamFieldLabel">描述</span>
              <textarea v-model="teamForm.description" class="mx-input" rows="2" placeholder="团队一句话定位" />
            </label>
            <label :class="$style.teamFieldRow">
              <span :class="$style.teamFieldLabel">Profile</span>
              <textarea v-model="teamForm.profile" class="mx-input" rows="6" placeholder="团队人设定义（保存后写入 TEAM.md 正文）" />
            </label>
            <div :class="$style.teamFormActions">
              <button type="button" class="mx-btn" @click="cancelTeamEditing">取消</button>
              <button type="button" class="mx-btn mx-btn--primary" :disabled="teamSaving" @click="saveTeamEdits">
                <span v-if="teamSaving" class="mx-text-loading">保存中…</span>
                <template v-else>保存</template>
              </button>
            </div>
          </div>
          <div v-else :class="$style.teamEditForm">
            <label :class="$style.teamFieldRow">
              <span :class="$style.teamFieldLabel">负责人</span>
              <select v-model="teamForm.leader" class="mx-input">
                <option value="" disabled>选择负责人（必填）</option>
                <option v-for="a in agentOptions" :key="a.name" :value="a.name">{{ a.label }}</option>
              </select>
            </label>
            <label :class="$style.teamFieldRow">
              <span :class="$style.teamFieldLabel">成员</span>
              <select v-model="teamForm.members" class="mx-input" multiple size="6">
                <option v-for="a in agentOptions" :key="a.name" :value="a.name">{{ a.label }}</option>
              </select>
            </label>
            <div :class="$style.teamFormActions">
              <button type="button" class="mx-btn" @click="cancelTeamEditing">取消</button>
              <button type="button" class="mx-btn mx-btn--primary" :disabled="teamSaving" @click="saveTeamEdits">
                <span v-if="teamSaving" class="mx-text-loading">保存中…</span>
                <template v-else>保存</template>
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- ── 下方配置面板（上下结构的"下"） ── -->
      <div v-else-if="selectedAgent" :class="$style.config">
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
              <!-- 昵称（展示主名）双态：点击 inline 编辑（agent.update nick_name，空串清空，展示回退 role/name） -->
              <input
                v-if="editingNick"
                ref="nickInputEl"
                v-model="nickDraft"
                :class="$style.cfgNickInput"
                :disabled="store.operating === selectedAgent.name"
                placeholder="设置昵称，留空清除"
                @keydown.enter.prevent="saveNick"
                @keydown.esc.prevent="cancelNick"
                @blur="saveNick"
              />
              <h3
                v-else
                :class="[$style.cfgName, $style.cfgNameEditable]"
                title="点击修改昵称"
                @click="startNickEdit"
              >{{ agentDisplayName(selectedAgent) }}</h3>
              <span v-if="agentRoleSubtitle(selectedAgent)" :class="$style.cfgRole">{{ agentRoleSubtitle(selectedAgent) }}</span>
              <!-- Leader 标识其负责的团队（team.list 口径）；点击直达团队管理对话框 -->
              <button
                v-if="leaderTeam"
                type="button"
                class="mx-tag"
                data-tone="info"
                :title="`管理团队「${teamDisplayName(leaderTeam)}」`"
                @click="store.openTeamEditor('edit', leaderTeam.name)"
              >
                {{ teamDisplayName(leaderTeam) }}
              </button>
              <!-- 决策计量：整体评价双指（agent.rate，同对象每日一次） -->
              <MetricRateButtons subject-type="agent" :name="selectedAgent.name" />
            </div>
            <p :class="$style.cfgDesc">{{ selectedAgent.description || '暂无描述' }}</p>
          </div>
          <!-- 团队区（负责人行专属）：成员头像堆叠（紧密排列，前一个覆盖后一个左边一半）
               +「管理团队」入口（TeamEditorModal，team.update 实体编辑）；非负责人行不再提供组队入口 -->
          <template v-if="leaderTeam">
            <div v-if="teamMemberAvatars.length" :class="$style.teamStack" title="团队成员">
              <template v-for="m in teamMemberAvatars" :key="m.name">
                <img v-if="m.icon" :class="$style.teamStackAvatar" :src="m.icon" :alt="m.displayName" :title="m.displayName" />
                <span v-else :class="$style.teamStackAvatar" :title="m.displayName">{{ m.displayName.charAt(0).toUpperCase() }}</span>
              </template>
            </div>
            <button
              type="button"
              class="mx-btn"
              :disabled="store.teamOperating === leaderTeam.name"
              @click="store.openTeamEditor('edit', leaderTeam.name)"
            >
              管理团队
            </button>
          </template>
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

    <!-- 团队编辑对话框：本组件是 agents 设置页常驻行，作为 TeamEditorModal 唯一挂载点
         （TeamsRecruitRow / 本行经 store.openTeamEditor 打开，同状态驱动避免双浮层） -->
    <TeamEditorModal />
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

/* 页签行：页签组独占一行且水平居中；右端"新建团队"入口绝对定位（页签居中不受影响） */
.tabsRow {
  display: flex;
  justify-content: center;
  position: relative;
}
.tabsNewTeam {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
}

/* ── 团队配置面板（只读展示 + 编辑表单；mx-* 全局类管观感，布局一律 $style 模块类） ── */
.teamReadView {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}
.teamReadBlock {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}
.teamReadLabel {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.teamReadValue {
  font: var(--mx-font-body);
  color: var(--mx-text);
}
.teamProfilePreview {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  padding: var(--mx-space-3);
}
.teamReadActions {
  display: flex;
  justify-content: flex-end;
}
.teamMemberList {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-wrap: wrap;
}
.teamEditForm {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}
.teamFieldRow {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}
.teamFieldLabel {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.teamFormActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
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

/* 昵称可编辑态：悬浮提示可点（虚线下划线），点击进入 inline 编辑 */
.cfgNameEditable {
  cursor: pointer;
  text-decoration: underline dashed transparent;
  text-underline-offset: 4px;
}

.cfgNameEditable:hover {
  color: var(--mx-text-secondary);
  text-decoration-color: color-mix(in srgb, var(--mx-text-tertiary) 55%, transparent);
}

/* 昵称编辑输入框：标题字形 + 底边线（对齐 inline 编辑惯例） */
.cfgNickInput {
  width: 160px;
  padding: 0 var(--mx-space-1);
  border: none;
  border-bottom: 1px solid var(--mx-accent);
  background: transparent;
  outline: none;
  font: var(--mx-font-heading);
  color: var(--mx-text);
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
</style>
