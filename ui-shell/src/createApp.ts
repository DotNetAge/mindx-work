/** 装配入口：执行插件清单、启动期暴露冲突与缺失（契约第 7 节） */

import { createChangeHub } from './changes'
import { createFileTypesContext, type FileTypesContext } from './fileTypes'
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

/** AppShell 总面：六视图区 + 服务上下文 + 文件类型接管注册表 + 壳机制状态 */
export interface AppShell<C> {
  readonly Sidebar: SidebarViewApi<C>
  readonly Content: ContentViewApi<C>
  readonly Detail: DetailViewApi<C>
  readonly Overlay: OverlayViewApi<C>
  readonly Toolbar: ToolbarViewApi<C>
  readonly Settings: PreferencesApi<C>
  readonly services: ServiceContext
  /** 文件类型接管注册表：插件声明扩展名 → 打开服务名（路由方查询分派） */
  readonly fileTypes: FileTypesContext
  /** 结构版本：任何视图区条目 / 壳状态变更后递增，适配器据此同步 */
  readonly version: number
  /** 订阅结构变更，返回取消订阅函数 */
  subscribe(listener: () => void): Unsubscribe
  /** 壳机制：Sidebar 折叠（壳唯一写） */
  readonly sidebarCollapsed: boolean
  toggleSidebar(): void
  /** 壳机制：Sidebar Footer 固定区折叠（壳唯一写） */
  readonly footerCollapsed: boolean
  toggleFooter(): void
  /** 壳机制：Content 中列收起（Detail 全屏让位，壳唯一写） */
  readonly contentCollapsed: boolean
  toggleContent(): void
  /** 生命周期：执行全部插件清理函数（热更 = 重执行插件前的准备） */
  dispose(): void
}

export function createApp<C>(plugins: readonly Plugin<C>[]): AppShell<C> {
  const hub = createChangeHub()
  // 装配层接线（层模型激活链 Sidebar→Content→Detail）：Detail 先建，
  // Content.onActivate 里做「展开才联动」——激活插件有 owner 归属的 Detail
  // 层则切换（缺区回退：无则保持原内容）；轨道收起时不动、不自动弹出
  const Detail = createDetailView<C>(hub)
  const Content = createContentView<C>(hub, {
    onActivate: (id) => {
      if (!Detail.shown) return
      const owned = Detail.entries
        .filter((entry) => entry.owner === id)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))[0]
      if (owned) Detail.setActiveTab(owned.id)
    },
  })
  const shell: AppShell<C> = {
    Sidebar: createSidebarView<C>(hub),
    Content,
    Detail,
    Overlay: createOverlayView<C>(hub),
    Toolbar: createToolbarView<C>(hub),
    Settings: createPreferences<C>(hub),
    services: createServiceContext(),
    fileTypes: createFileTypesContext(),
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
    get footerCollapsed() {
      return footerCollapsed
    },
    toggleFooter() {
      footerCollapsed = !footerCollapsed
      hub.bump()
    },
    get contentCollapsed() {
      return contentCollapsed
    },
    toggleContent() {
      contentCollapsed = !contentCollapsed
      hub.bump()
    },
    dispose() {
      // 逆序执行清理：后注册者先清理
      for (const cleanup of [...cleanups].reverse()) cleanup()
      cleanups.length = 0
    },
  }
  let sidebarCollapsed = false
  let contentCollapsed = false
  let footerCollapsed = false

  // 全屏态守护：Content 收起（全屏让位）后 Detail 也收起，则整窗无内容区可看——
  // Detail 收起动作（hide / popActiveTab 退无可退）联动恢复 Content（装配层接线，壳唯一写）
  const detailHide = Detail.hide.bind(Detail)
  const detailPop = Detail.popActiveTab.bind(Detail)
  Detail.hide = () => {
    detailHide()
    if (!Detail.shown && contentCollapsed) {
      contentCollapsed = false
      hub.bump()
    }
  }
  Detail.popActiveTab = () => {
    detailPop()
    if (!Detail.shown && contentCollapsed) {
      contentCollapsed = false
      hub.bump()
    }
  }

  // 启动装配：顺序执行插件清单，收集清理函数
  const cleanups: Array<() => void> = []
  for (const plugin of plugins) {
    const cleanup = plugin(shell)
    if (typeof cleanup === 'function') {
      cleanups.push(cleanup)
    }
  }

  // 启动期校验：硬约束在此暴露（契约第 10 节）
  validateShellConstraints(shell)

  return shell
}

/** 契约硬约束校验：Sidebar 行 id → Content 条目映射、Preferences 行 → 页归属。
 * 启动期由 createApp 调用一次；动态插件注册完成后由 loader 复调
 * （契约 §18.1 六区契约对动态插件完全适用——激活期违规同样要暴露） */
export function validateShellConstraints<C>(shell: AppShell<C>): void {
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

  // 层归属校验：owner 指向的 Content 条目必须存在（省略 = 全局层 / 独立唤起层）
  for (const entry of shell.Toolbar.entries) {
    if (entry.owner && !contentIds.has(entry.owner)) {
      throw new Error(
        `启动期校验失败：Toolbar 条目 "${entry.id}" 归属的 Content 条目 "${entry.owner}" 不存在`,
      )
    }
  }
  for (const entry of shell.Detail.entries) {
    if (entry.owner && !contentIds.has(entry.owner)) {
      throw new Error(
        `启动期校验失败：Detail 条目 "${entry.id}" 归属的 Content 条目 "${entry.owner}" 不存在`,
      )
    }
  }
}
