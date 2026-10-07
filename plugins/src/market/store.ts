/**
 * market 插件内部状态（Model）：已安装清单 + 市场索引 + 安装/启停/切版/卸载动作 +
 * mindx 市场团队货架（kind=team 团队整包招聘，经 daemon.connection 服务）。
 * 壳编排归组件（Overlay.add/remove），本 store 只持数据与宿主桥/daemon 调用。
 * 环境边界（契约 §17）：市场索引是网络数据，渲染侧消费处做结构校验（schemaVersion 未知拒绝）；
 * 宿主桥缺失（纯 Web）时全部动作显式报错，不做静默降级。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  MARKET_RUNTIME_SERVICE,
  PLUGIN_CATALOG_SERVICE,
  type CorePluginInfo,
  type InstalledPluginView,
  type MarketPluginView,
  type MarketRuntime,
  type MarketVersionView,
} from '@mindx-work/ui-shell'
import { useService } from '@mindx-work/ui-shell-vue'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 同名冲突（团队或任一成员 Agent 已存在，后端默认拒绝；调用方捕获后走覆盖确认重试） */
export class TeamExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamExistsError'
  }
}

/**
 * mindx 市场分发包条目（market.list 货架项）。本插件仅消费 kind=team 的团队整包
 * （安装 = 团队 + 全部成员 Agent 一次落位，成员默认未雇佣），字段与冻结协议对齐。
 */
export interface MarketTeamPackage {
  kind: 'agent' | 'skill' | 'team'
  name: string
  description?: string
  icon?: string
  /** 昵称（展示主名；缺失回退 name） */
  nick_name?: string
  /** 业务分类（中文原文） */
  category?: string
  /** 负责人 Agent 名（kind=team） */
  leader?: string
  /** 包内成员 Agent 名（kind=team，含负责人；卡片显示成员数） */
  members?: string[]
  /** 包版本 */
  version?: string
  /** 包文件相对清单地址的路径（服务端分页 API 响应可为空，下载走 download_url 直连） */
  file?: string
  /** 包文件下载直连地址（服务端分页 API 下发；安装直连无需清单拼接） */
  download_url?: string
  sha256: string
  size?: number
}

/** market.list 结果（仅保留本插件消费字段） */
interface MarketTeamListResult {
  packages: MarketTeamPackage[]
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
export function teamPkgDisplayName(pkg: MarketTeamPackage): string {
  return (typeof pkg.nick_name === 'string' && pkg.nick_name.trim()) || pkg.name
}

function bridge(): NonNullable<Window['mxDesktop']>['plugins'] {
  const plugins = window.mxDesktop?.plugins
  if (!plugins) throw new Error('当前环境不支持插件市场（需要应用宿主）')
  return plugins
}

/** 市场索引结构校验（消费处唯一家）：未知 schemaVersion 拒绝；形状不合格条目跳过 */
function parseMarketIndex(raw: unknown): MarketPluginView[] {
  if (typeof raw !== 'object' || raw === null) throw new Error('市场索引不是对象')
  const data = raw as { schemaVersion?: unknown; plugins?: unknown }
  if (data.schemaVersion !== 1) {
    throw new Error(`市场索引 schemaVersion ${String(data.schemaVersion)} 未知，拒绝读取`)
  }
  if (!Array.isArray(data.plugins)) throw new Error('市场索引缺少 plugins 数组')
  const entries: MarketPluginView[] = []
  for (const item of data.plugins) {
    const e = item as Partial<MarketPluginView>
    if (
      typeof e.id !== 'string' ||
      typeof e.name !== 'string' ||
      typeof e.description !== 'string' ||
      typeof e.author !== 'string' ||
      typeof e.license !== 'string' ||
      !Array.isArray(e.versions) ||
      !e.versions.every(
        (v) =>
          typeof v?.version === 'string' &&
          typeof v?.url === 'string' &&
          typeof v?.sha256 === 'string',
      )
    ) {
      continue
    }
    entries.push({
      id: e.id,
      name: e.name,
      description: e.description,
      author: e.author,
      url: e.url,
      repo: e.repo,
      license: e.license,
      permissions: Array.isArray(e.permissions) ? e.permissions : [],
      versions: e.versions,
    })
  }
  return entries
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
  const market = ref<MarketPluginView[]>([])
  const marketError = ref<string | null>(null)
  const loadingMarket = ref(false)
  /** 待确认安装（市场条目 + 全部可装版本）；null = 关闭 */
  const pendingConfirm = ref<{ entry: MarketPluginView; versions: MarketVersionView[] } | null>(null)
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

  async function refreshMarket(): Promise<void> {
    loadingMarket.value = true
    marketError.value = null
    try {
      market.value = parseMarketIndex(await bridge().marketList())
    } catch (error) {
      market.value = []
      marketError.value = error instanceof Error ? error.message : String(error)
    } finally {
      loadingMarket.value = false
    }
  }

  function requestConfirm(entry: MarketPluginView): void {
    lastError.value = null
    pendingConfirm.value = { entry, versions: entry.versions }
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
  async function confirmInstall(version: MarketVersionView): Promise<void> {
    const entry = pendingConfirm.value?.entry
    if (!entry) return
    if (!beginBusy(entry.id)) return
    lastError.value = null
    try {
      runtime.deactivate(entry.id)
      const result = await bridge().installFromUrl(version.url, version.sha256)
      if (!result.ok) throw new Error(result.message ?? '安装失败')
      await refreshInstalled()
      const view = installed.value.find((p) => p.id === entry.id)
      if (view?.enabled) {
        try {
          await runtime.activate(view)
        } catch {
          // 首次激活失败：停用落盘，保持盘上状态与运行期一致，用户可从列表重新启用
          lastError.value = '已安装但首次激活失败，可从已安装列表重新启用'
          await bridge().setEnabled(entry.id, false).catch(() => undefined)
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

  // ---------- 团队货架（mindx 市场 kind=team 包，团队整包招聘；daemon RPC） ----------
  // 服务端分页 API 为主入口（契约 §2.2）：搜索走服务端 q，滚动触底由哨兵追加；
  // API 不可达时 daemon 回退静态清单过滤并在 warning 附原因。
  const TEAM_PAGE_SIZE = 30
  const teamPackages = ref<MarketTeamPackage[]>([])
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
    teamPackages.value.push(...(res.packages || []))
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
  async function installTeamPackage(pkg: MarketTeamPackage, overwrite = false): Promise<TeamInstallResult> {
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
  async function installTeam(pkg: MarketTeamPackage): Promise<TeamInstallResult> {
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

  return {
    installed,
    corePlugins,
    market,
    marketError,
    loadingMarket,
    pendingConfirm,
    lastError,
    busyId,
    hasBridge,
    refreshInstalled,
    refreshMarket,
    requestConfirm,
    cancelConfirm,
    confirmInstall,
    enable,
    disable,
    switchVersion,
    uninstall,
    exportPlugin,
    importFromFile,
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
  }
})
