/**
 * market 插件内部状态（Model）：已安装清单 + 安装/启停/切版/卸载动作 +
 * mindx 市场四货架（成员/技能/团队/插件，market.list kind 分页，经 daemon.connection 服务）。
 * 插件货架数据源统一走 daemon 市场服务（kind=plugin），宿主桥只承担下载落盘（installFromUrl）。
 * 壳编排归组件（Overlay.add/remove），本 store 只持数据与宿主桥/daemon 调用。
 * 环境边界（契约 §17）：宿主桥缺失（纯 Web）时全部动作显式报错，不做静默降级。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  MARKET_RUNTIME_SERVICE,
  PLUGIN_CATALOG_SERVICE,
  type CorePluginInfo,
  type InstalledPluginView,
  type MarketRuntime,
} from '@mindx-work/ui-shell'
import { useService } from '@mindx-work/ui-shell-vue'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  /** 订阅 daemon 通知（如 market_changed 换源广播）；返回退订函数 */
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

/**
 * 市场分发包条目（market.list 货架项，四货架共用；字段与冻结协议对齐）。
 */
export interface MarketPkg {
  kind: 'agent' | 'skill' | 'team' | 'plugin'
  name: string
  description?: string
  icon?: string
  /** 昵称（展示主名；缺失回退 name） */
  nick_name?: string
  /** 岗位头衔（kind=agent） */
  role?: string
  /** 业务分类（中文原文） */
  category?: string
  /** 负责人 Agent 名（kind=team） */
  leader?: string
  /** 包内成员 Agent 名（kind=team，含负责人） */
  members?: string[]
  /** 包内技能名 */
  skills?: string[]
  /** 技能中文展示名映射（技能名 → metadata.name_zh） */
  skillNames?: Record<string, string>
  /** 包版本 */
  version?: string
  /** 包文件相对清单地址的路径（服务端分页 API 响应可为空，下载走 download_url 直连） */
  file?: string
  /** 包文件下载直连地址（服务端分页 API 下发） */
  download_url?: string
  sha256: string
  size?: number
  /** 插件元数据（kind=plugin；安装确认弹窗的信任呈现依据） */
  author?: string
  license?: string
  permissions?: string[]
}

/** 货架展示名（统一显示规则：昵称优先，回退包名） */
export function pkgDisplayName(pkg: MarketPkg): string {
  return (typeof pkg.nick_name === 'string' && pkg.nick_name.trim()) || pkg.name
}

/** 同名冲突（成员包；后端默认拒绝，调用方捕获后走覆盖确认重试） */
export class AgentExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentExistsError'
  }
}

/** 同名冲突（技能包；后端默认拒绝，调用方捕获后走覆盖确认重试） */
export class SkillExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillExistsError'
  }
}

/** 同名冲突（团队或任一成员 Agent 已存在，后端默认拒绝；调用方捕获后走覆盖确认重试） */
export class TeamExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamExistsError'
  }
}

/** market.list 结果（仅保留本插件消费字段） */
interface MarketTeamListResult {
  packages: MarketPkg[]
  source: 'remote' | 'cache'
  /** 降级原因（source=cache 时非空） */
  warning?: string
  /** 服务端命中的总条数（带分页参数时返回） */
  total?: number
  /** 当前页码（1 起始，带分页参数时返回） */
  page?: number
}

/** market.install 结果（kind=team 时 members 报告落位的成员 Agent 名，含负责人） */
export interface TeamInstallResult {
  kind: 'agent' | 'skill' | 'team'
  name: string
  skills_global?: string[]
  skills_agent?: string[]
  members?: string[]
  overwritten?: boolean
}

/** 团队包展示名（统一显示规则：昵称优先，回退包名） */
export function teamPkgDisplayName(pkg: MarketPkg): string {
  return (typeof pkg.nick_name === 'string' && pkg.nick_name.trim()) || pkg.name
}

function bridge(): NonNullable<Window['mxDesktop']>['plugins'] {
  const plugins = window.mxDesktop?.plugins
  if (!plugins) throw new Error('当前环境不支持插件市场（需要应用宿主）')
  return plugins
}

export const useMarketStore = defineStore('market', () => {
  // 运行期控制在 store 初始化时捕获（首次 useMarketStore 发生在组件 setup 内，
  // inject 有效；action/异步任务里 useService 会因脱离 setup 上下文抛错）
  const runtime = useService<MarketRuntime>(MARKET_RUNTIME_SERVICE)
  // 预置插件目录（app 装配层 provide）：全量视图的「内置」段数据源
  const coreCatalog = useService<CorePluginInfo[]>(PLUGIN_CATALOG_SERVICE)
  // daemon 连接为可选依赖：团队货架是智能主机能力，服务缺失时货架区块隐藏而非崩溃
  const daemon = (() => {
    try {
      return useService<DaemonConnection>(DAEMON_CONNECTION)
    } catch {
      return null
    }
  })()

  const installed = ref<InstalledPluginView[]>([])
  /** 预置插件快照（拷贝防外部改写 provide 的原数组） */
  const corePlugins = ref<CorePluginInfo[]>([...coreCatalog])
  /** 待确认安装（插件货架条目）；null = 关闭 */
  const pendingConfirm = ref<{ pkg: MarketPkg } | null>(null)
  /** 最近一次操作错误（行内展示） */
  const lastError = ref<string | null>(null)
  /** 正在执行动作的插件 id（按钮防重） */
  const busyId = ref<string | null>(null)

  const hasBridge = computed(() => window.mxDesktop?.plugins != null)

  /** 上一帧清单快照（id → { enabled, version }）；null = 尚未首刷（首刷只建快照不触发激活，
   * 避免把 app 启动期已激活的插件误判为「CLI 新装」重复 activate） */
  let lastSnapshot: Map<string, { enabled: boolean; version: string }> | null = null

  function snapshotOf(views: InstalledPluginView[]): Map<string, { enabled: boolean; version: string }> {
    return new Map(views.map((v) => [v.id, { enabled: v.enabled, version: v.version }]))
  }

  /** 刷新清单并与上一帧差分：来自 mw CLI 的盘上变更即时落到运行期——
   * 新装且启用 → 激活；停用 → 停活；激活版本变化 → 先停活再激活（自扩展闭环的 app 侧感知）。
   * UI 自身的安装/启停/切版也走此路径：无差异时 diff 空转，幂等安全 */
  async function refreshInstalled(): Promise<void> {
    try {
      const list = await bridge().list()
      const fresh = Array.isArray(list) ? list : []
      const next = snapshotOf(fresh)
      if (lastSnapshot !== null) {
        for (const [id, cur] of next) {
          const old = lastSnapshot.get(id)
          // 值比较（快照对象逐帧重建，引用恒异）
          if (old && old.enabled === cur.enabled && old.version === cur.version) continue
          try {
            if (!old) {
              if (cur.enabled) {
                const view = fresh.find((v) => v.id === id)
                if (view) await runtime.activate(view)
              }
            } else if (old.enabled && !cur.enabled) {
              runtime.deactivate(id)
            } else if (old.enabled && cur.enabled && old.version !== cur.version) {
              runtime.deactivate(id)
              const view = fresh.find((v) => v.id === id)
              if (view) await runtime.activate(view)
            }
          } catch (error) {
            lastError.value = error instanceof Error ? error.message : String(error)
          }
        }
        // 卸载（快照有、新帧无）：运行期兜底停活
        for (const id of lastSnapshot.keys()) {
          if (!next.has(id)) {
            try {
              runtime.deactivate(id)
            } catch {
              // 已未激活：幂等忽略
            }
          }
        }
      }
      installed.value = fresh
      lastSnapshot = next
    } catch (error) {
      installed.value = []
      lastError.value = error instanceof Error ? error.message : String(error)
    }
  }

  // mw CLI 落盘 → 主进程 watch 广播 → 即时重扫激活（订阅在 store 初始化期，hasBridge 宿主才生效）
  if (hasBridge.value) {
    bridge().onChanged(() => {
      void refreshInstalled()
    })
  }

  // ---------- 插件货架（market.list kind=plugin；服务端分页 + 服务端 q 搜索；
  // 数据源统一走 daemon 市场服务，宿主桥只承担下载落盘与 sha256 校验） ----------
  const pluginPackages = ref<MarketPkg[]>([])
  const pluginPage = ref(0)
  const pluginTotal = ref(0)
  const pluginDone = ref(false)
  const pluginSearch = ref('')
  const pluginLoaded = ref(false)
  const pluginLoading = ref(false)
  const pluginLoadingMore = ref(false)
  const pluginError = ref<string | null>(null)

  /** 已安装插件 id 集合（市场条目 name 即反向域 id，同名视为已安装） */
  const installedPluginIds = computed(() => new Set(installed.value.map((p) => p.id)))

  async function fetchPluginPage(): Promise<void> {
    if (!daemon) return
    const seq = pluginLoadSeq
    const q = pluginSearch.value.trim()
    const res = await daemon.call<MarketTeamListResult>('market.list', {
      page: pluginPage.value + 1,
      page_size: SHELF_PAGE_SIZE,
      kind: 'plugin',
      ...(q ? { q } : {}),
    })
    if (seq !== pluginLoadSeq) return
    pluginPackages.value.push(...filterByKind(res.packages || [], 'plugin'))
    pluginPage.value = res.page || pluginPage.value + 1
    if (typeof res.total === 'number') {
      pluginTotal.value = res.total
      if (pluginPage.value * SHELF_PAGE_SIZE >= res.total) pluginDone.value = true
    } else if ((res.packages || []).length < SHELF_PAGE_SIZE) {
      pluginTotal.value = pluginPage.value * SHELF_PAGE_SIZE
      pluginDone.value = true
    }
  }

  /** 加载序号：每次 loadPluginMarket 递增，过期响应据此丢弃 */
  let pluginLoadSeq = 0

  async function loadPluginMarket(): Promise<void> {
    if (!daemon) return
    const seq = ++pluginLoadSeq
    pluginLoading.value = true
    pluginError.value = null
    pluginPackages.value = []
    pluginPage.value = 0
    pluginTotal.value = 0
    pluginDone.value = false
    try {
      await fetchPluginPage()
      if (seq === pluginLoadSeq) pluginLoaded.value = true
    } catch (error) {
      pluginError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (seq === pluginLoadSeq) pluginLoading.value = false
    }
  }

  async function loadPluginMarketMore(): Promise<void> {
    if (!daemon || pluginLoading.value || pluginLoadingMore.value || pluginDone.value) return
    pluginLoadingMore.value = true
    try {
      await fetchPluginPage()
    } catch (error) {
      pluginError.value = error instanceof Error ? error.message : String(error)
    } finally {
      pluginLoadingMore.value = false
    }
  }

  function requestConfirm(pkg: MarketPkg): void {
    lastError.value = null
    pendingConfirm.value = { pkg }
  }

  function cancelConfirm(): void {
    pendingConfirm.value = null
  }

  /** 动作入口防重：全局单飞（跨插件也不并发）——UI 只禁同 id 按钮，入口兜底防并发竞态 */
  function beginBusy(id: string): boolean {
    if (busyId.value !== null) return false
    busyId.value = id
    return true
  }

  /** 安装确认：停用旧代际（幂等）→ 下载落盘（宿主校验 sha256）→ 刷新清单 → 激活新代际。
   * 激活失败时停用落盘保持"盘上状态与运行期一致"，报错提示重新启用 */
  async function confirmInstall(): Promise<void> {
    const pkg = pendingConfirm.value?.pkg
    if (!pkg) return
    if (!beginBusy(pkg.name)) return
    lastError.value = null
    try {
      runtime.deactivate(pkg.name)
      const result = await bridge().installFromUrl(pkg.download_url ?? '', pkg.sha256)
      if (!result.ok) throw new Error(result.message ?? '安装失败')
      await refreshInstalled()
      const view = installed.value.find((p) => p.id === pkg.name)
      if (view?.enabled) {
        try {
          await runtime.activate(view)
        } catch {
          // 首次激活失败：停用落盘，保持盘上状态与运行期一致，用户可从列表重新启用
          lastError.value = '已安装但首次激活失败，可从已安装列表重新启用'
          await bridge().setEnabled(pkg.name, false).catch(() => undefined)
        }
      }
      pendingConfirm.value = null
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
    } finally {
      busyId.value = null
    }
  }

  /** 启用：激活成功后才落盘状态（激活失败状态不翻转，注释与行为一致） */
  async function enable(view: InstalledPluginView): Promise<void> {
    if (!beginBusy(view.id)) return
    lastError.value = null
    try {
      await runtime.activate(view)
      if (!(await bridge().setEnabled(view.id, true))) throw new Error('启用失败')
      await refreshInstalled()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      await refreshInstalled()
    } finally {
      busyId.value = null
    }
  }

  /** 停用：先执行清理函数再落盘（清理失败由运行期内部隔离，不阻塞停用） */
  async function disable(view: InstalledPluginView): Promise<void> {
    if (!beginBusy(view.id)) return
    lastError.value = null
    try {
      runtime.deactivate(view.id)
      if (!(await bridge().setEnabled(view.id, false))) throw new Error('停用失败')
      await refreshInstalled()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      await refreshInstalled()
    } finally {
      busyId.value = null
    }
  }

  /** 切换激活版本：停用 → 切指针 → 激活新代际；指针切换失败时重激活旧代际回滚 */
  async function switchVersion(view: InstalledPluginView, version: string): Promise<void> {
    if (!beginBusy(view.id)) return
    lastError.value = null
    try {
      runtime.deactivate(view.id)
      if (!(await bridge().setActiveVersion(view.id, version))) {
        throw new Error('版本切换失败')
      }
      await refreshInstalled()
      const next = installed.value.find((p) => p.id === view.id)
      if (next?.enabled) {
        await runtime.activate(next)
      }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      // 指针未迁移成功：重激活旧代际恢复运行期（停用已发生，回滚激活）
      await refreshInstalled()
      const rollback = installed.value.find((p) => p.id === view.id)
      if (rollback?.enabled) {
        await runtime.activate(rollback).catch(() => undefined)
      }
    } finally {
      busyId.value = null
    }
  }

  /** 卸载：停用 → 删除全部版本目录并移出清单；删除失败时重激活恢复运行期 */
  async function uninstall(view: InstalledPluginView): Promise<void> {
    if (!beginBusy(view.id)) return
    lastError.value = null
    try {
      runtime.deactivate(view.id)
      if (!(await bridge().uninstall(view.id))) throw new Error('卸载失败')
      await refreshInstalled()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      await refreshInstalled()
      const rollback = installed.value.find((p) => p.id === view.id)
      if (rollback?.enabled) {
        await runtime.activate(rollback).catch(() => undefined)
      }
    } finally {
      busyId.value = null
    }
  }

  /** 导出激活代际为 zip（保存对话框归主进程）；返回回执供组件提示，失败走 lastError */
  async function exportPlugin(view: InstalledPluginView): Promise<{ ok: boolean; path?: string }> {
    if (!beginBusy(view.id)) return { ok: false }
    lastError.value = null
    try {
      const result = await bridge().export(view.id)
      if (!result.ok) throw new Error(result.message ?? '导出失败')
      return { ok: true, path: result.path }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { ok: false }
    } finally {
      busyId.value = null
    }
  }

  /** 导入本地插件包（zip）：主进程弹选择对话框 → 同一安装管线落盘 → 刷新清单 */
  async function importFromFile(): Promise<void> {
    if (!beginBusy('__import__')) return
    lastError.value = null
    try {
      const result = await bridge().installFromFile()
      if (!result.ok) {
        if (result.message !== '已取消') throw new Error(result.message ?? '导入失败')
        return
      }
      await refreshInstalled()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
    } finally {
      busyId.value = null
    }
  }

  // ---------- 市场源（daemon user.config market_source_id/market_pat；列表经 market.sources RPC） ----------
  /** 可用源清单（market.sources RPC 转发服务端 /sources；商户源需令牌解锁） */
  interface MarketSourceItem {
    id: string
    name: string
    tier: 'public' | 'merchant'
    manifest_url: string
    selected: boolean
  }
  const sources = ref<MarketSourceItem[]>([])
  const sourcesLoading = ref(false)
  const sourcesError = ref<string | null>(null)
  /** 商户访问令牌是否已配置（user.config market_pat_set 布尔，令牌明文不回读） */
  const patSet = ref(false)
  /** 换源序号：换源动作与 market_changed 广播后递增，货架据此重置重拉 */
  const sourceEpoch = ref(0)

  /** 刷新源状态与清单：user.config 取 market_source_id/market_pat_set，market.sources 拉列表 */
  async function fetchSource(): Promise<void> {
    if (!daemon) return
    const cfg = await daemon.call<Record<string, unknown>>('user.config', {})
    patSet.value = cfg?.market_pat_set === true
    sourcesLoading.value = true
    sourcesError.value = null
    try {
      const res = await daemon.call<{ sources?: MarketSourceItem[] }>('market.sources', {})
      sources.value = Array.isArray(res?.sources) ? res.sources : []
    } catch (err) {
      sourcesError.value = err instanceof Error ? err.message : String(err)
    } finally {
      sourcesLoading.value = false
    }
  }

  /** 保存选中的源 id（空串恢复官方 Default），daemon 解析清单地址重建客户端并广播。
   * 本地立即递增 epoch 兼容旧 daemon（静默忽略未注册 key、不广播）；新 daemon 广播
   * 会再递增一次，货架 loadXxx 为幂等重置，多拉一次可接受。 */
  async function setSource(sourceID: string): Promise<void> {
    if (!daemon) throw new Error('更换市场源需要连接智能主机')
    await daemon.call('user.config', { market_source_id: sourceID })
    sourceEpoch.value++
    void fetchSource()
  }

  /** 保存商户源访问令牌（写 user.config market_pat；明文不回读）。成功后重拉源清单解锁商户源 */
  async function setPAT(pat: string): Promise<void> {
    if (!daemon) throw new Error('配置访问令牌需要连接智能主机')
    await daemon.call('user.config', { market_pat: pat })
    patSet.value = true
    sourceEpoch.value++
    void fetchSource()
  }

  /** 订阅换源广播（市场页 onMounted 调用一次；返回退订函数）。覆盖其他端换源场景；
   * 本机换源已即时递增，广播到达会再递增一次，货架重拉幂等可接受 */
  function watchMarketChanged(): () => void {
    if (!daemon) return () => { }
    return daemon.onNotification('market_changed', () => {
      sourceEpoch.value++
      void fetchSource()
    })
  }

  // ---------- 成员货架（market.list kind=agent；服务端分页 + 服务端 q 搜索） ----------
  const SHELF_PAGE_SIZE = 30
  const agentPackages = ref<MarketPkg[]>([])
  const agentPage = ref(0)
  const agentTotal = ref(0)
  const agentDone = ref(false)
  const agentSearch = ref('')
  const agentWarning = ref('')
  const agentLoaded = ref(false)
  const agentLoading = ref(false)
  const agentLoadingMore = ref(false)
  const agentError = ref<string | null>(null)
  /** 正在招募/散伙的包名（按钮 loading） */
  const installingAgent = ref('')
  /** 已招募员工名集合（本地注册表口径：agent.list hired=true） */
  const hiredNames = ref<Set<string>>(new Set())
  /** 技能中文名映射（skill.list → metadata.name_zh；卡片技能标签显示用） */
  const skillZhMap = ref<Record<string, string>>({})

  /** 刷新本地参照：已招募员工集合 + 技能中文名映射（货架招募态与技能标签的数据源） */
  async function refreshLocalRefs(): Promise<void> {
    if (!daemon) return
    try {
      const list = await daemon.call<Array<{ name: string; hired?: boolean }>>('agent.list', {})
      hiredNames.value = new Set((list || []).filter((a) => a.hired).map((a) => a.name))
    } catch {
      /* 参照刷新失败不阻断货架：招募态回退为未招募 */
    }
    try {
      const list = await daemon.call<Array<{ name: string; metadata?: Record<string, string> }>>('skill.list', {})
      const map: Record<string, string> = {}
      for (const s of list || []) {
        const zh = s.metadata?.name_zh
        if (zh) map[s.name] = zh
      }
      skillZhMap.value = map
    } catch {
      /* 中文名映射失败回退原名 */
    }
  }

  /** 货架条目按请求 kind 防御过滤：旧 daemon 的 market.list 忽略 kind 返回全量清单，
   * 不过滤会让团队货架混入 agent/skill 包（实证 bug）。 */
  function filterByKind(items: MarketPkg[], kind: MarketPkg['kind']): MarketPkg[] {
    return items.filter((p) => p.kind === kind)
  }

  async function fetchAgentPage(): Promise<void> {
    if (!daemon) return
    const seq = agentLoadSeq
    const q = agentSearch.value.trim()
    const res = await daemon.call<MarketTeamListResult>('market.list', {
      page: agentPage.value + 1,
      page_size: SHELF_PAGE_SIZE,
      kind: 'agent',
      ...(q ? { q } : {}),
    })
    if (seq !== agentLoadSeq) return
    agentPackages.value.push(...filterByKind(res.packages || [], 'agent'))
    if (res.warning) agentWarning.value = res.warning
    agentPage.value = res.page || agentPage.value + 1
    if (typeof res.total === 'number') {
      agentTotal.value = res.total
      if (agentPage.value * SHELF_PAGE_SIZE >= res.total) agentDone.value = true
    } else if ((res.packages || []).length < SHELF_PAGE_SIZE) {
      // 无 total（回退形态未带计数）：返回不足一页即到底
      agentTotal.value = agentPage.value * SHELF_PAGE_SIZE
      agentDone.value = true
    }
  }

  /** 加载序号：每次 loadAgentMarket 递增，过期响应据此丢弃 */
  let agentLoadSeq = 0

  /** 重新拉取成员货架：重置游标取第一页（懒加载 / 搜索防抖 / 换源 / 刷新共用入口） */
  async function loadAgentMarket(): Promise<void> {
    if (!daemon) return
    const seq = ++agentLoadSeq
    agentLoading.value = true
    agentError.value = null
    agentWarning.value = ''
    agentPackages.value = []
    agentPage.value = 0
    agentTotal.value = 0
    agentDone.value = false
    try {
      await Promise.all([fetchAgentPage(), refreshLocalRefs()])
      if (seq === agentLoadSeq) agentLoaded.value = true
    } catch (error) {
      agentError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (seq === agentLoadSeq) agentLoading.value = false
    }
  }

  /** 无限滚动追加：滚动触底时取下一页 */
  async function loadAgentMarketMore(): Promise<void> {
    if (!daemon || agentLoading.value || agentLoadingMore.value || agentDone.value) return
    agentLoadingMore.value = true
    try {
      await fetchAgentPage()
    } catch (error) {
      agentError.value = error instanceof Error ? error.message : String(error)
    } finally {
      agentLoadingMore.value = false
    }
  }

  /** 安装市场成员包（market.install kind=agent；同名冲突默认拒绝，错误原样上抛由组件确认后 overwrite 重试） */
  async function installAgentPackage(pkg: MarketPkg, overwrite = false): Promise<void> {
    if (!daemon) throw new Error('成员安装需要连接智能主机')
    try {
      await daemon.call('market.install', { kind: 'agent', name: pkg.name, ...(overwrite ? { overwrite: true } : {}) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在同名智能体')) throw new AgentExistsError(msg)
      throw err
    }
    await Promise.all([refreshLocalRefs(), refreshSkillRefs()])
  }

  /** 招募（一键语义）：始终先安装（市场包自包含技能装配）再雇佣 */
  async function recruitAgent(pkg: MarketPkg): Promise<void> {
    await installAgentPackage(pkg)
    if (!daemon) return
    await daemon.call('agent.hire', { name: pkg.name })
    await refreshLocalRefs()
  }

  /** 散伙（市场卡片已招募态按钮；与团队货架的成员散伙同 RPC） */
  async function fireAgent(name: string): Promise<void> {
    if (!daemon) throw new Error('散伙需要连接智能主机')
    await daemon.call('agent.fire', { name })
    await refreshLocalRefs()
  }

  // ---------- 技能货架（market.list kind=skill；服务端分页 + 服务端 q 搜索） ----------
  const skillPackages = ref<MarketPkg[]>([])
  const skillPage = ref(0)
  const skillTotal = ref(0)
  const skillDone = ref(false)
  const skillSearch = ref('')
  const skillWarning = ref('')
  const skillLoaded = ref(false)
  const skillLoading = ref(false)
  const skillLoadingMore = ref(false)
  const skillError = ref<string | null>(null)
  /** 正在安装的包名（按钮 loading） */
  const installingSkill = ref('')
  /** 已安装技能名集合（本地全局库口径：skill.list） */
  const installedSkillNames = ref<Set<string>>(new Set())

  async function refreshSkillRefs(): Promise<void> {
    if (!daemon) return
    try {
      const list = await daemon.call<Array<{ name: string }>>('skill.list', {})
      installedSkillNames.value = new Set((list || []).map((s) => s.name))
    } catch {
      /* 已安装集合刷新失败不阻断货架 */
    }
  }

  async function fetchSkillPage(): Promise<void> {
    if (!daemon) return
    const seq = skillLoadSeq
    const q = skillSearch.value.trim()
    const res = await daemon.call<MarketTeamListResult>('market.list', {
      page: skillPage.value + 1,
      page_size: SHELF_PAGE_SIZE,
      kind: 'skill',
      ...(q ? { q } : {}),
    })
    if (seq !== skillLoadSeq) return
    skillPackages.value.push(...filterByKind(res.packages || [], 'skill'))
    if (res.warning) skillWarning.value = res.warning
    skillPage.value = res.page || skillPage.value + 1
    if (typeof res.total === 'number') {
      skillTotal.value = res.total
      if (skillPage.value * SHELF_PAGE_SIZE >= res.total) skillDone.value = true
    } else if ((res.packages || []).length < SHELF_PAGE_SIZE) {
      skillTotal.value = skillPage.value * SHELF_PAGE_SIZE
      skillDone.value = true
    }
  }

  /** 加载序号：每次 loadSkillMarket 递增，过期响应据此丢弃 */
  let skillLoadSeq = 0

  async function loadSkillMarket(): Promise<void> {
    if (!daemon) return
    const seq = ++skillLoadSeq
    skillLoading.value = true
    skillError.value = null
    skillWarning.value = ''
    skillPackages.value = []
    skillPage.value = 0
    skillTotal.value = 0
    skillDone.value = false
    try {
      await Promise.all([fetchSkillPage(), refreshSkillRefs()])
      if (seq === skillLoadSeq) skillLoaded.value = true
    } catch (error) {
      skillError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (seq === skillLoadSeq) skillLoading.value = false
    }
  }

  async function loadSkillMarketMore(): Promise<void> {
    if (!daemon || skillLoading.value || skillLoadingMore.value || skillDone.value) return
    skillLoadingMore.value = true
    try {
      await fetchSkillPage()
    } catch (error) {
      skillError.value = error instanceof Error ? error.message : String(error)
    } finally {
      skillLoadingMore.value = false
    }
  }

  /** 安装市场技能包（market.install kind=skill；同名冲突默认拒绝，错误原样上抛） */
  async function installSkillPackage(pkg: MarketPkg, overwrite = false): Promise<void> {
    if (!daemon) throw new Error('技能安装需要连接智能主机')
    try {
      await daemon.call('market.install', { kind: 'skill', name: pkg.name, ...(overwrite ? { overwrite: true } : {}) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在同名技能')) throw new SkillExistsError(msg)
      throw err
    }
    await refreshSkillRefs()
  }

  // ---------- 团队货架（mindx 市场 kind=team 包，团队整包招聘；daemon RPC） ----------
  // 服务端分页 API 为主入口（契约 §2.2）：搜索走服务端 q，滚动触底由哨兵追加；
  // API 不可达时 daemon 回退静态清单过滤并在 warning 附原因。
  const TEAM_PAGE_SIZE = 30
  const teamPackages = ref<MarketPkg[]>([])
  const teamMarketPage = ref(0) // 已拉取页码（1 起始，0 = 尚未拉取）
  const teamMarketTotal = ref(0) // 服务端命中总数
  const teamMarketDone = ref(false) // 已到服务端末页
  const teamMarketWarning = ref('')
  const teamMarketLoaded = ref(false)
  const teamMarketLoading = ref(false)
  const teamMarketLoadingMore = ref(false)
  const teamMarketError = ref<string | null>(null)
  /** 搜索词（组件防抖后调 loadTeamMarket，服务端 q 过滤 name/description） */
  const teamSearch = ref('')
  /** 正在安装的团队包名（按钮 loading） */
  const installingTeam = ref('')

  /** 团队货架可用性（daemon 连接存在才展示区块） */
  const teamAvailable = computed(() => daemon !== null)

  /** 加载序号：每次 loadTeamMarket 递增，过期响应据此丢弃（防旧请求污染新列表） */
  let teamLoadSeq = 0

  /** 拉取团队货架下一页并追加（带参走服务端分页；API 不可达时 daemon 回退静态清单过滤并附 warning）。
   * seq 为启动时的加载序号：await 返回后序号已变（期间触发了新一轮加载）则丢弃本次响应 */
  async function fetchTeamPage(): Promise<void> {
    if (!daemon) return
    const seq = teamLoadSeq
    const q = teamSearch.value.trim()
    const res = await daemon.call<MarketTeamListResult>('market.list', {
      page: teamMarketPage.value + 1,
      page_size: TEAM_PAGE_SIZE,
      kind: 'team',
      ...(q ? { q } : {}),
    })
    if (seq !== teamLoadSeq) return
    teamPackages.value.push(...filterByKind(res.packages || [], 'team'))
    if (res.warning) teamMarketWarning.value = res.warning
    teamMarketPage.value = res.page || teamMarketPage.value + 1
    if (typeof res.total === 'number') {
      teamMarketTotal.value = res.total
      if (teamMarketPage.value * TEAM_PAGE_SIZE >= res.total) teamMarketDone.value = true
    } else if ((res.packages || []).length < TEAM_PAGE_SIZE) {
      // 无 total（回退形态未带计数）：返回不足一页即到底
      teamMarketTotal.value = teamMarketPage.value * TEAM_PAGE_SIZE
      teamMarketDone.value = true
    }
  }

  /** 重新拉取团队货架：重置游标取第一页（懒加载 / 搜索防抖 / 刷新共用入口） */
  async function loadTeamMarket(): Promise<void> {
    if (!daemon) return
    const seq = ++teamLoadSeq
    teamMarketLoading.value = true
    teamMarketError.value = null
    teamMarketWarning.value = ''
    teamPackages.value = []
    teamMarketPage.value = 0
    teamMarketTotal.value = 0
    teamMarketDone.value = false
    try {
      await fetchTeamPage()
      if (seq === teamLoadSeq) teamMarketLoaded.value = true
    } catch (error) {
      teamMarketError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (seq === teamLoadSeq) teamMarketLoading.value = false
    }
  }

  /** 无限滚动追加：滚动触底时取下一页（到底后不再请求） */
  async function loadTeamMarketMore(): Promise<void> {
    if (!daemon || teamMarketLoading.value || teamMarketLoadingMore.value || teamMarketDone.value) return
    teamMarketLoadingMore.value = true
    try {
      await fetchTeamPage()
    } catch (error) {
      teamMarketError.value = error instanceof Error ? error.message : String(error)
    } finally {
      teamMarketLoadingMore.value = false
    }
  }

  /** 安装团队整包（market.install kind=team）：团队 + 全部成员 Agent 一次落位，
   * 成员默认未雇佣。同名冲突（团队/任一成员）默认拒绝——错误消息含"已存在同名"
   * 时抛 TeamExistsError 供覆盖确认后 overwrite 重试 */
  async function installTeamPackage(pkg: MarketPkg, overwrite = false): Promise<TeamInstallResult> {
    if (!daemon) throw new Error('团队安装需要连接智能主机')
    try {
      return await daemon.call<TeamInstallResult>('market.install', {
        kind: 'team',
        name: pkg.name,
        ...(overwrite ? { overwrite: true } : {}),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在同名')) throw new TeamExistsError(msg)
      throw err
    }
  }

  /** 团队整包安装入口（组件调用）：installing loading 包裹，结果与异常原样上抛
   * （编排归组件：成功通知与覆盖确认 modal 由组件处理，范式同 agents 插件） */
  async function installTeam(pkg: MarketPkg): Promise<TeamInstallResult> {
    installingTeam.value = pkg.name
    try {
      return await installTeamPackage(pkg)
    } finally {
      installingTeam.value = ''
    }
  }

  // ---------- 团队安装确认范式（modal 组件消费；覆盖重试用，形状对齐 agents 插件） ----------
  const teamPendingConfirm = ref<{ title: string; message: string; confirmText: string; successText: string } | null>(null)
  let teamConfirmAction: (() => Promise<unknown>) | null = null

  function requestTeamConfirm(
    title: string,
    message: string,
    confirmText: string,
    successText: string,
    action: () => Promise<unknown>,
  ): void {
    teamPendingConfirm.value = { title, message, confirmText, successText }
    teamConfirmAction = action
  }

  /** 确认执行：清空状态后执行动作，返回成功文案供调用方推送通知 */
  async function runTeamConfirm(): Promise<string | undefined> {
    const action = teamConfirmAction
    const successText = teamPendingConfirm.value?.successText
    teamConfirmAction = null
    teamPendingConfirm.value = null
    await action?.()
    return successText
  }

  function cancelTeamConfirm(): void {
    teamConfirmAction = null
    teamPendingConfirm.value = null
  }

  // ---------- 成员/技能安装覆盖确认（modal 组件消费；范式同团队确认） ----------
  const agentPendingConfirm = ref<{ title: string; message: string; confirmText: string; successText: string } | null>(null)
  let agentConfirmAction: (() => Promise<unknown>) | null = null

  function requestAgentConfirm(
    title: string,
    message: string,
    confirmText: string,
    successText: string,
    action: () => Promise<unknown>,
  ): void {
    agentPendingConfirm.value = { title, message, confirmText, successText }
    agentConfirmAction = action
  }

  async function runAgentConfirm(): Promise<string | undefined> {
    const action = agentConfirmAction
    const successText = agentPendingConfirm.value?.successText
    agentConfirmAction = null
    agentPendingConfirm.value = null
    await action?.()
    return successText
  }

  function cancelAgentConfirm(): void {
    agentConfirmAction = null
    agentPendingConfirm.value = null
  }

  const skillPendingConfirm = ref<{ title: string; message: string; confirmText: string; successText: string } | null>(null)
  let skillConfirmAction: (() => Promise<unknown>) | null = null

  function requestSkillConfirm(
    title: string,
    message: string,
    confirmText: string,
    successText: string,
    action: () => Promise<unknown>,
  ): void {
    skillPendingConfirm.value = { title, message, confirmText, successText }
    skillConfirmAction = action
  }

  async function runSkillConfirm(): Promise<string | undefined> {
    const action = skillConfirmAction
    const successText = skillPendingConfirm.value?.successText
    skillConfirmAction = null
    skillPendingConfirm.value = null
    await action?.()
    return successText
  }

  function cancelSkillConfirm(): void {
    skillConfirmAction = null
    skillPendingConfirm.value = null
  }

  return {
    installed,
    corePlugins,
    pendingConfirm,
    lastError,
    busyId,
    hasBridge,
    refreshInstalled,
    requestConfirm,
    cancelConfirm,
    confirmInstall,
    enable,
    disable,
    switchVersion,
    uninstall,
    exportPlugin,
    importFromFile,
    // 插件货架（market.list kind=plugin；数据源统一走 daemon 市场服务，安装经宿主桥落盘）
    pluginPackages,
    pluginTotal,
    pluginDone,
    pluginSearch,
    pluginLoaded,
    pluginLoading,
    pluginLoadingMore,
    pluginError,
    installedPluginIds,
    loadPluginMarket,
    loadPluginMarketMore,
    // 市场源（换源入口：源列表选择 + 商户访问令牌；货架刷新由广播与本地 epoch 双驱动）
    sources,
    sourcesLoading,
    sourcesError,
    patSet,
    sourceEpoch,
    fetchSource,
    setSource,
    setPAT,
    watchMarketChanged,
    // 成员货架（market.list kind=agent；服务端分页：搜索/追加加载）
    agentPackages,
    agentTotal,
    agentDone,
    agentSearch,
    agentWarning,
    agentLoaded,
    agentLoading,
    agentLoadingMore,
    agentError,
    installingAgent,
    hiredNames,
    skillZhMap,
    loadAgentMarket,
    loadAgentMarketMore,
    installAgentPackage,
    recruitAgent,
    fireAgent,
    // 技能货架（market.list kind=skill；服务端分页：搜索/追加加载）
    skillPackages,
    skillTotal,
    skillDone,
    skillSearch,
    skillWarning,
    skillLoaded,
    skillLoading,
    skillLoadingMore,
    skillError,
    installingSkill,
    installedSkillNames,
    loadSkillMarket,
    loadSkillMarketMore,
    installSkillPackage,
    // 团队货架（mindx 市场 kind=team 包；服务端分页：搜索/追加加载）
    teamPackages,
    teamMarketWarning,
    teamMarketLoaded,
    teamMarketLoading,
    teamMarketLoadingMore,
    teamMarketPage,
    teamMarketTotal,
    teamMarketDone,
    teamSearch,
    teamMarketError,
    installingTeam,
    teamAvailable,
    loadTeamMarket,
    loadTeamMarketMore,
    installTeam,
    installTeamPackage,
    teamPendingConfirm,
    requestTeamConfirm,
    runTeamConfirm,
    cancelTeamConfirm,
    // 成员/技能安装覆盖确认（modal 组件消费）
    agentPendingConfirm,
    requestAgentConfirm,
    runAgentConfirm,
    cancelAgentConfirm,
    skillPendingConfirm,
    requestSkillConfirm,
    runSkillConfirm,
    cancelSkillConfirm,
  }
})
