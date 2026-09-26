/**
 * agents 插件内部状态（Model）：员工清单 + 招募/散伙 + 市场货架与安装 + 云技能/技能清单。
 * 数据读写全部经 daemon.connection 服务（daemon 为唯一连接源）；
 * 壳编排（Overlay 开合、banner 推送、FLIP 详情）归组件，本 store 只持数据与 RPC 调用。
 * 动作失败一律抛错由调用方呈现（banner），同名冲突以 AgentExistsError 供调用方走覆盖确认。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useService } from '@mindx-work/ui-shell-vue'
import type {
  AgentDetailResp,
  AgentMeta,
  AgentUpdateParams,
  BundleInstallResult,
  CloudConnectorEntry,
  HireResult,
  MarketAgentPackage,
  MarketListResult,
  SkillInfo,
} from './types'
import { FIXED_DOMAINS } from './types'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 同名智能体冲突（后端默认拒绝已存在目标；调用方捕获后走覆盖确认重试） */
export class AgentExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentExistsError'
  }
}

/** 员工展示名：role（中文角色名）优先，回退 name 标识符 */
export function agentDisplayName(a: AgentMeta): string {
  return (typeof a.role === 'string' && a.role.trim()) || a.name
}

/** 市场包展示名：role 优先，回退包名 */
export function marketPkgDisplayName(pkg: MarketAgentPackage): string {
  return (typeof pkg.role === 'string' && pkg.role.trim()) || pkg.name
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

  // ---------- 技能清单（技能装备中文名回退链 + 技能分配多选源） ----------
  const skills = ref<SkillInfo[]>([])
  const skillsLoaded = ref(false)

  async function loadSkills(): Promise<void> {
    skills.value = await daemon.call<SkillInfo[]>('skill.list', {})
    skillsLoaded.value = true
  }

  /** 技能中文名映射（技能名 → metadata.name_zh；未声明中文名的技能不收录） */
  const skillZhMap = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const s of skills.value) {
      const zh = s.metadata?.name_zh
      if (zh) map[s.name] = String(zh)
    }
    return map
  })

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

  // ---------- 在线市场（agent 类型分发包；懒加载：首次切到市场视图才拉清单） ----------
  const marketPackages = ref<MarketAgentPackage[]>([])
  const marketWarning = ref('')
  const marketLoaded = ref(false)
  const marketLoading = ref(false)
  /** 正在招募（安装+雇佣）的市场包名称（按钮 loading） */
  const installing = ref('')

  /** 拉取市场清单（仅展示 agent 类型包；在线优先，失败降级本地缓存并附 warning） */
  async function loadMarket(): Promise<void> {
    marketLoading.value = true
    try {
      const res = await daemon.call<MarketListResult>('market.list', {})
      marketPackages.value = (res.packages || []).filter((p) => p.kind === 'agent')
      marketWarning.value = res.warning || ''
      marketLoaded.value = true
    } finally {
      marketLoading.value = false
    }
  }

  /** 已安装（出现在本地注册表）的智能体名集合 */
  const installedNames = computed<Set<string>>(() => new Set(agents.value.map((a) => a.name)))

  /** 市场货架分类标签：清单 category 去重，固定分类在前、其余字典序在后 */
  const marketDomains = computed<string[]>(() => {
    const present = new Set<string>()
    for (const p of marketPackages.value) {
      const c = (p.category || '').trim()
      if (c) present.add(c)
    }
    const ordered = FIXED_DOMAINS.filter((d) => present.has(d))
    const rest = [...present].filter((d) => !FIXED_DOMAINS.includes(d)).sort()
    return [...ordered, ...rest]
  })

  /** 安装市场智能体包（下载 → sha256 校验 → 落地注册表与技能库） */
  async function installAgentPackage(pkg: MarketAgentPackage, overwrite = false): Promise<void> {
    try {
      await daemon.call<BundleInstallResult>('market.install', {
        kind: 'agent',
        name: pkg.name,
        ...(overwrite ? { overwrite: true } : {}),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在同名智能体')) throw new AgentExistsError(msg)
      throw err
    }
  }

  /**
   * 市场卡片招募（一键语义）：始终先安装（市场包自包含技能装配，必须落地）再雇佣。
   * 不能因"已安装"跳过安装：本地旧版会缺失市场包内嵌的技能。
   * 成功后重拉员工与技能清单（Agent 包可能同时扩充全局技能库）。
   */
  async function recruitMarketPackage(pkg: MarketAgentPackage): Promise<void> {
    installing.value = pkg.name
    try {
      await installAgentPackage(pkg)
      await Promise.all([refreshAgents(), loadSkills()])
      await hire(pkg.name)
    } finally {
      installing.value = ''
    }
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

  // ---------- 确认范式（modal 组件消费；市场覆盖安装共用） ----------
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
    skillZhMap,
    // 招募/散伙
    operating,
    hire,
    fire,
    // 市场
    marketPackages,
    marketWarning,
    marketLoaded,
    marketLoading,
    installing,
    loadMarket,
    installedNames,
    marketDomains,
    installAgentPackage,
    recruitMarketPackage,
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
