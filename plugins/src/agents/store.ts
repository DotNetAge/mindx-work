/**
 * agents 插件内部状态（Model）：员工清单 + 招募/散伙 + 云技能/技能清单。
 * 数据读写全部经 daemon.connection 服务（daemon 为唯一连接源）；
 * 壳编排（Overlay 开合、banner 推送）归组件，本 store 只持数据与 RPC 调用。
 * 动作失败一律抛错由调用方呈现（banner）。
 */

import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { useService } from '@mindx-work/ui-shell-vue'
import type {
  AgentDetailResp,
  AgentMeta,
  AgentUpdateParams,
  CloudConnectorEntry,
  HireResult,
  SkillInfo,
  TeamDetail,
  TeamMeta,
  TeamUpdateParams,
} from './types'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

/**
 * 员工展示名（统一显示规则）：昵称（nick_name，2-3 字外号）为主名，Role 作小字副题；
 * 昵称缺失时回退 role，再回退 name 标识符。role 小字仅在昵称生效时展示（调用方
 * 可用 agentRoleSubtitle 判断），避免「role 回退时主副重复」。
 */
export function agentDisplayName(a: AgentMeta): string {
  return (typeof a.nick_name === 'string' && a.nick_name.trim()) || (typeof a.role === 'string' && a.role.trim()) || a.name
}

/** 员工副题小字（Role）：仅在昵称生效（主名不是 role）时返回，否则空串 */
export function agentRoleSubtitle(a: AgentMeta): string {
  const nick = typeof a.nick_name === 'string' ? a.nick_name.trim() : ''
  if (!nick) return ''
  return (typeof a.role === 'string' && a.role.trim()) || ''
}

/** 技能展示名：中文名（metadata.name_zh）优先，回退原名 */
export function skillDisplayName(s: SkillInfo): string {
  const zh = s.metadata?.name_zh
  return (typeof zh === 'string' && zh.trim()) || s.name
}

/** 技能描述：中文环境优先 metadata.description_zh，回退原始 description */
export function skillLocaleDesc(s: SkillInfo): string {
  const zh = s.metadata?.description_zh
  return (typeof zh === 'string' && zh.trim()) || s.description || ''
}

/** 团队展示名（统一显示规则同员工）：昵称优先，回退团队名 */
export function teamDisplayName(t: TeamMeta): string {
  return (typeof t.nick_name === 'string' && t.nick_name.trim()) || t.name
}

export const useAgentsStore = defineStore('agents-store', () => {
  // 服务本体在 store 初始化时捕获（首次 useAgentsStore 由组件 setup 触发，inject 有效）
  const daemon = useService<DaemonConnection>(DAEMON_CONNECTION)

  // ---------- 员工清单 ----------
  const agents = ref<AgentMeta[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function refreshAgents(): Promise<void> {
    agents.value = await daemon.call<AgentMeta[]>('agent.list', {})
    loaded.value = true
  }

  /** 带加载态拉取员工清单（首开与安装后刷新） */
  async function loadAgents(): Promise<void> {
    loading.value = true
    try {
      await refreshAgents()
    } finally {
      loading.value = false
    }
  }

  /** 已招募员工（团队视图只陈列已招募者） */
  const hiredAgents = computed<AgentMeta[]>(() => agents.value.filter((a) => a.hired))

  // ---------- 技能清单（技能分配多选源） ----------
  const skills = ref<SkillInfo[]>([])
  const skillsLoaded = ref(false)

  async function loadSkills(): Promise<void> {
    skills.value = await daemon.call<SkillInfo[]>('skill.list', {})
    skillsLoaded.value = true
  }

  // ---------- 招募 / 散伙 ----------
  /** 正在执行招募/散伙的 Agent 名（按钮 loading，防连点） */
  const operating = ref('')

  /** 招募（agent.hire）；成功后按返回的 hired 状态局部更新清单 */
  async function hire(name: string): Promise<void> {
    const res = await daemon.call<HireResult>('agent.hire', { name })
    const target = agents.value.find((a) => a.name === name)
    if (target) target.hired = res.hired
  }

  /** 散伙（agent.fire）；成功后按返回的 hired 状态局部更新清单 */
  async function fire(name: string): Promise<void> {
    const res = await daemon.call<HireResult>('agent.fire', { name })
    const target = agents.value.find((a) => a.name === name)
    if (target) target.hired = res.hired
  }

  // ---------- 团队（一等 Team 实体，team.* RPC） ----------
  const teams = ref<TeamMeta[]>([])
  const teamsLoading = ref(false)
  const teamsLoaded = ref(false)
  /** 正在执行团队雇佣/解雇/删除的团队名（按钮 loading，防连点） */
  const teamOperating = ref('')

  async function refreshTeams(): Promise<void> {
    teams.value = await daemon.call<TeamMeta[]>('team.list', {})
    teamsLoaded.value = true
  }

  /** 带加载态拉取团队清单（团队招聘区首开与动作后刷新） */
  async function loadTeams(): Promise<void> {
    teamsLoading.value = true
    try {
      await refreshTeams()
    } finally {
      teamsLoading.value = false
    }
  }

  /** 已雇佣团队（切换器去重与团队会话口径） */
  const hiredTeams = computed<TeamMeta[]>(() => teams.value.filter((t) => t.hired))

  /** 拉取团队详情（profile 正文以 team.get 为准） */
  async function loadTeamDetail(name: string): Promise<TeamDetail> {
    return daemon.call<TeamDetail>('team.get', { name })
  }

  /** 保存团队（team.update，创建与编辑共用；指针语义见 TeamUpdateParams） */
  async function updateTeam(params: TeamUpdateParams): Promise<void> {
    await daemon.call('team.update', params)
  }

  /** 删除团队（team.delete；成功后局部移出清单） */
  async function deleteTeam(name: string): Promise<void> {
    await daemon.call('team.delete', { name })
    teams.value = teams.value.filter((t) => t.name !== name)
  }

  /** 雇佣团队（team.hire）；返回结构未冻结，成功后重拉清单对齐 hired 态 */
  async function hireTeam(name: string): Promise<void> {
    teamOperating.value = name
    try {
      await daemon.call('team.hire', { name })
      await refreshTeams()
    } finally {
      teamOperating.value = ''
    }
  }

  /** 解雇团队（team.fire）；同 hireTeam 重拉清单 */
  async function fireTeam(name: string): Promise<void> {
    teamOperating.value = name
    try {
      await daemon.call('team.fire', { name })
      await refreshTeams()
    } finally {
      teamOperating.value = ''
    }
  }

  // ---------- 决策计量：整体评价（白皮书《决策量表》7.2 管理页辅收集） ----------

  /** 已评价对象当日集合（限频的本地镜像；daemon 校验为准） */
  const ratedToday = reactive(new Set<string>())

  /**
   * 整体评价上报（agent.rate）：限频校验在 daemon（同对象每日一次）。
   * 返回 ok=false + already_rated_today 时调用方提示"今日已评过"。
   */
  async function rateSubject(subjectType: 'agent' | 'team' | 'skill', name: string, value: 'up' | 'down', text?: string): Promise<{ ok: boolean; reason?: string }> {
    const key = `${subjectType}:${name}`
    if (ratedToday.has(key)) return { ok: false, reason: 'already_rated_today' }
    const res = await daemon.call<{ ok?: boolean; reason?: string } | null>('agent.rate', {
      subject_type: subjectType,
      name,
      value,
      text: text || undefined,
    })
    if (res && res.ok === false) return { ok: false, reason: res.reason }
    ratedToday.add(key)
    return { ok: true }
  }

  // 团队/员工热重载广播：团队整包安装（market.install kind=team）等外部变更落盘后
  // daemon 广播到达即静默重拉清单（已加载过才拉，避免后台空转；失败不打扰，下次
  // 广播或手动刷新自愈。范式同 skills store 的 skills_changed 订阅）
  daemon.onNotification('teams_changed', () => {
    if (!teamsLoaded.value) return
    void refreshTeams().catch(() => {
      // 后台保新失败不打扰（下次广播自愈）
    })
  })
  daemon.onNotification('agents_changed', () => {
    if (!loaded.value) return
    void refreshAgents().catch(() => {
      // 后台保新失败不打扰（下次广播自愈）
    })
  })

  // ---------- 团队编辑器（TeamsRecruitRow / AgentsManagerRow 共用对话框的数据源） ----------
  /** null = 关闭；mode=create 新建，mode=edit 以 name 预填（profile 经 team.get 回填） */
  const teamEditor = ref<{ mode: 'create' | 'edit'; name?: string } | null>(null)

  function openTeamEditor(mode: 'create' | 'edit', name?: string): void {
    teamEditor.value = { mode, name }
  }

  function closeTeamEditor(): void {
    teamEditor.value = null
  }

  // ---------- 详情 / 保存 ----------
  /** 拉取员工详情（IDENTITY 正文 = introduction，SOUL 正文 = soul，allows_tools 云技能清单） */
  async function loadAgentDetail(name: string): Promise<AgentDetailResp> {
    return daemon.call<AgentDetailResp>('agent.get', { name })
  }

  /** 保存员工配置（agent.update；失败抛错由调用方呈现） */
  async function updateAgent(params: AgentUpdateParams): Promise<void> {
    await daemon.call('agent.update', params)
  }

  // ---------- 云技能（技能连接器：enabled=true 的 MCP 服务，勾选写入 allows_tools） ----------
  const connectors = ref<CloudConnectorEntry[]>([])
  const cloudLoading = ref(false)
  const cloudLoaded = ref(false)

  /** 拉取启用的技能连接器清单（title 优先为展示名，描述降级为空串） */
  async function loadConnectors(): Promise<void> {
    cloudLoading.value = true
    try {
      const list = await daemon.call<CloudConnectorEntry[]>('mcp.server.list', {})
      connectors.value = (list || [])
        .filter((s) => s.enabled)
        .map((s) => ({
          name: String(s.name || ''),
          title: String(s.title || '').trim() || String(s.name || ''),
          description: String(s.description || '').trim(),
        }))
      cloudLoaded.value = true
    } finally {
      cloudLoading.value = false
    }
  }

  // ---------- 许可证阅读 ----------
  const license = ref<{ title: string; content: string } | null>(null)

  function openLicense(title: string, content: string): void {
    license.value = { title, content }
  }

  // ---------- 确认范式（modal 组件消费；TeamEditorModal 删除确认等共用） ----------
  const pendingConfirm = ref<{ title: string; message: string; confirmText: string; successText: string } | null>(null)
  let confirmAction: (() => Promise<unknown>) | null = null

  function requestConfirm(
    title: string,
    message: string,
    confirmText: string,
    successText: string,
    action: () => Promise<unknown>,
  ): void {
    pendingConfirm.value = { title, message, confirmText, successText }
    confirmAction = action
  }

  /** 确认执行：清空状态后执行动作，返回成功文案供调用方推送通知 */
  async function runConfirm(): Promise<string | undefined> {
    const action = confirmAction
    const successText = pendingConfirm.value?.successText
    confirmAction = null
    pendingConfirm.value = null
    await action?.()
    return successText
  }

  function cancelConfirm(): void {
    confirmAction = null
    pendingConfirm.value = null
  }

  return {
    // 员工清单
    agents,
    loading,
    loaded,
    loadAgents,
    refreshAgents,
    hiredAgents,
    // 技能清单
    skills,
    skillsLoaded,
    loadSkills,
    // 招募/散伙
    operating,
    hire,
    fire,
    // 团队（一等 Team 实体）
    teams,
    teamsLoading,
    teamsLoaded,
    teamOperating,
    loadTeams,
    refreshTeams,
    hiredTeams,
    loadTeamDetail,
    updateTeam,
    deleteTeam,
    hireTeam,
    fireTeam,
    // 决策计量：整体评价
    rateSubject,
    ratedToday,
    teamEditor,
    openTeamEditor,
    closeTeamEditor,
    // 详情/保存
    loadAgentDetail,
    updateAgent,
    // 云技能
    connectors,
    cloudLoading,
    cloudLoaded,
    loadConnectors,
    // 许可证
    license,
    openLicense,
    // 确认
    pendingConfirm,
    requestConfirm,
    runConfirm,
    cancelConfirm,
  }
})
