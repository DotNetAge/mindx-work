/**
 * 在线插件动态加载器（渲染侧）。
 * 契约统一：动态插件入口与静态插件同为 (app: AppShell) => cleanup，第一参就是壳总面；
 * 第二参 mx 提供渲染工具（h / MxIcon）——动态插件无 import 通道，渲染件由壳注入。
 * 信任模型（定稿）：显式安装即信任 + 清单全量校验；校验唯一家 = ui-shell manifestIssues。
 * 失败隔离：单个插件加载失败收集为失败清单（banner 展示），不阻塞其它插件与壳首帧。
 * 运行期控制：MarketRuntime 持有激活插件的清理函数，启停/切版/卸载时先行停用。
 */
import type { AppShell, InstalledPluginView, MarketRuntime } from '@mindx-work/ui-shell'
import { manifestIssues, validateShellConstraints, type PluginManifest } from '@mindx-work/ui-shell'
import { h } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

/** 渲染工具包：动态插件第二参（无 import 通道，由壳注入） */
export interface RenderKit {
  h: typeof h
  MxIcon: typeof MxIcon
}

/** 动态插件入口签名（与静态插件契约一致，多一个渲染工具包参数） */
export type MarketPluginEntry = (app: AppShell<unknown>, mx: RenderKit) => void | (() => void)

export interface MarketLoadFailure {
  id: string
  message: string
}

/** 拉取已安装清单并激活全部启用中的插件；返回失败清单（隔离不阻塞） */
export async function loadMarketPlugins(
  app: AppShell<unknown>,
  runtime: MarketRuntime,
): Promise<MarketLoadFailure[]> {
  const bridge = window.mxDesktop?.plugins
  // 纯 Web 环境（无 Electron 桥）没有在线插件，直接跳过
  if (!bridge) return []
  const installed = await bridge.list()
  if (!Array.isArray(installed)) return []

  const failures: MarketLoadFailure[] = []
  for (const view of installed) {
    if (!view.enabled) continue
    try {
      await runtime.activate(view)
    } catch (error) {
      failures.push({ id: view.id, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return failures
}

/** 激活代次计数器：ES module 同一 specifier 只求值一次，停用再启用/切版往返/
 * 卸载重装都需要重新执行入口函数，故每次激活用唯一 query 穿透模块缓存 */
let activateSeq = 0

/** 激活单个在线插件：清单全量校验（唯一家）→ 动态 import 入口 → 执行注册并返回清理函数 */
async function activateMarketPlugin(
  app: AppShell<unknown>,
  view: InstalledPluginView,
): Promise<() => void> {
  const base = `mx-plugin://${view.id}/${view.version}`
  const manifestRes = await fetch(`${base}/manifest.json`)
  if (!manifestRes.ok) throw new Error(`清单读取失败（HTTP ${manifestRes.status}）`)
  // JSON 解析失败（SyntaxError 英文）统一转中文提示
  const manifest = (await manifestRes.json().catch(() => {
    throw new Error('manifest.json 不是合法 JSON')
  })) as PluginManifest

  // 契约全量校验（ui-shell 唯一家）+ 目录身份一致性
  const issues = manifestIssues(manifest)
  if (issues.length > 0) throw new Error(`清单校验失败：${issues.join('；')}`)
  if (manifest.id !== view.id) throw new Error(`清单 id ${manifest.id} 与安装目录 ${view.id} 不一致`)

  // 动态 import：mx-plugin 特权协议（dev/prod 统一通道）；
  // query 只穿透模块缓存，协议 handler 按 pathname 解析不受影响
  activateSeq += 1
  const mod = (await import(
    /* @vite-ignore */ `${base}/${manifest.entry}?activate=${activateSeq}`
  )) as {
    default?: MarketPluginEntry
  }
  if (typeof mod.default !== 'function') throw new Error('入口缺少 default 导出函数')
  const cleanup = mod.default(app, { h, MxIcon })
  const cleanupFn = typeof cleanup === 'function' ? cleanup : () => {}

  // 激活期校验（契约 §18.1）：动态插件注册完成后复调壳硬约束校验，
  // 违规即视为激活失败——执行其清理函数回滚注册后抛错
  try {
    validateShellConstraints(app)
  } catch (error) {
    try {
      cleanupFn()
    } catch (cleanupError) {
      console.error('插件清理函数执行失败：', cleanupError instanceof Error ? cleanupError.message : cleanupError)
    }
    throw error
  }
  return cleanupFn
}

/** 创建在线插件运行期控制：激活幂等（已激活直接返回）、停用执行清理函数。
 * 并发防护：激活中（Promise 未落定）的插件被再次 activate 时复用在飞 Promise，
 * 避免跨 await 的 check-then-act 双跑入口导致重复注册 */
export function createMarketRuntime(app: AppShell<unknown>): MarketRuntime {
  const cleanups = new Map<string, () => void>()
  const inflight = new Map<string, Promise<void>>()
  return {
    async activate(view) {
      if (cleanups.has(view.id)) return
      const existing = inflight.get(view.id)
      if (existing) return existing
      const task = activateMarketPlugin(app, view)
        .then((cleanup) => {
          cleanups.set(view.id, cleanup)
        })
        .finally(() => {
          inflight.delete(view.id)
        })
      inflight.set(view.id, task)
      return task
    },
    deactivate(id) {
      const cleanup = cleanups.get(id)
      if (!cleanup) return
      cleanups.delete(id)
      try {
        cleanup()
      } catch (error) {
        // 清理失败不阻塞停用（注释语义兑现）：记录后继续——坏插件的清理函数不能卡死启停/卸载
        console.error(`插件 ${id} 清理函数执行失败：`, error instanceof Error ? error.message : error)
      }
    },
  }
}
