/** 装配入口：执行插件清单、启动期暴露冲突与缺失（契约第 7 节） */

import { createChangeHub } from './changes'
import { createServiceContext } from './services'
import {
  createContentView,
  createDetailView,
  createOverlayView,
  createPreferences,
  createSidebarView,
  createToolbarView,
  type ContentViewApi,
  type DetailViewApi,
  type OverlayViewApi,
  type PreferencesApi,
  type SidebarViewApi,
  type ToolbarViewApi,
} from './views'
import type { Plugin, ServiceContext, Unsubscribe } from './types'

/** AppShell 总面：六视图区 + 服务上下文 + 壳机制状态 */
export interface AppShell<C> {
  readonly Sidebar: SidebarViewApi<C>
  readonly Content: ContentViewApi<C>
  readonly Detail: DetailViewApi<C>
  readonly Overlay: OverlayViewApi<C>
  readonly Toolbar: ToolbarViewApi<C>
  readonly Settings: PreferencesApi<C>
  readonly services: ServiceContext
  /** 结构版本：任何视图区条目 / 壳状态变更后递增，适配器据此同步 */
  readonly version: number
  /** 订阅结构变更，返回取消订阅函数 */
  subscribe(listener: () => void): Unsubscribe
  /** 壳机制：Sidebar 折叠（壳唯一写） */
  readonly sidebarCollapsed: boolean
  toggleSidebar(): void
  /** 生命周期：执行全部插件清理函数（热更 = 重执行插件前的准备） */
  dispose(): void
}

export function createApp<C>(plugins: readonly Plugin<C>[]): AppShell<C> {
  const hub = createChangeHub()
  const shell: AppShell<C> = {
    Sidebar: createSidebarView<C>(hub),
    Content: createContentView<C>(hub),
    Detail: createDetailView<C>(hub),
    Overlay: createOverlayView<C>(hub),
    Toolbar: createToolbarView<C>(hub),
    Settings: createPreferences<C>(hub),
    services: createServiceContext(),
    get version() {
      return hub.version
    },
    subscribe: hub.subscribe,
    get sidebarCollapsed() {
      return sidebarCollapsed
    },
    toggleSidebar() {
      sidebarCollapsed = !sidebarCollapsed
      hub.bump()
    },
    dispose() {
      // 逆序执行清理：后注册者先清理
      for (const cleanup of [...cleanups].reverse()) cleanup()
      cleanups.length = 0
    },
  }
  let sidebarCollapsed = false

  // 启动装配：顺序执行插件清单，收集清理函数
  const cleanups: Array<() => void> = []
  for (const plugin of plugins) {
    const cleanup = plugin(shell)
    if (typeof cleanup === 'function') {
      cleanups.push(cleanup)
    }
  }

  // 启动期校验：硬约束在此暴露（契约第 10 节）
  validateOrThrow(shell)

  return shell
}

/** 启动期校验：Sidebar 行 id → Content 条目映射、Preferences 行 → 页归属 */
function validateOrThrow<C>(shell: AppShell<C>): void {
  const contentIds = new Set(shell.Content.entries.map((entry) => entry.id))
  for (const section of shell.Sidebar.entries) {
    for (const row of section.rows) {
      if (!contentIds.has(row.id)) {
        throw new Error(
          `启动期校验失败：Sidebar 行 "${row.id}"（节 "${section.id}"）没有对应的 Content 条目`,
        )
      }
    }
  }

  const pageIds = new Set(shell.Settings.pages.map((page) => page.id))
  for (const row of shell.Settings.rows) {
    if (row.page && !pageIds.has(row.page)) {
      throw new Error(`启动期校验失败：Preferences 行 "${row.id}" 指向不存在的页 "${row.page}"`)
    }
  }
}
