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
  PLUGIN_CATALOG_SERVICE,
  type CorePluginInfo,
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
  // 预置插件目录（app 装配层 provide）：全量视图的「内置」段数据源
  const coreCatalog = useService<CorePluginInfo[]>(PLUGIN_CATALOG_SERVICE)

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
  }
})
