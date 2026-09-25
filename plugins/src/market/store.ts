/**
 * market 插件内部状态（Model）：已安装清单 + 市场索引 + 安装/启停/切版/卸载动作。
 * 壳编排归组件（Overlay.add/remove），本 store 只持数据与宿主桥调用。
 * 环境边界（契约 §17）：市场索引是网络数据，渲染侧消费处做结构校验（schemaVersion 未知拒绝）；
 * 宿主桥缺失（纯 Web）时全部动作显式报错，不做静默降级。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  MARKET_RUNTIME_SERVICE,
  type InstalledPluginView,
  type MarketPluginView,
  type MarketRuntime,
  type MarketVersionView,
} from '@mindx-work/ui-shell'
import { useService } from '@mindx-work/ui-shell-vue'

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

  const installed = ref<InstalledPluginView[]>([])
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

  async function refreshInstalled(): Promise<void> {
    try {
      const list = await bridge().list()
      installed.value = Array.isArray(list) ? list : []
    } catch (error) {
      installed.value = []
      lastError.value = error instanceof Error ? error.message : String(error)
    }
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

  return {
    installed,
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
  }
})
