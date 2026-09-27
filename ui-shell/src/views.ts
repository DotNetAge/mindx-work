/**
 * 六视图区实现（契约第 4 节）：条目注册 + 壳机制状态（壳唯一写）。
 * 全部变更经 ChangeHub 广播，适配器订阅后映射为渲染层响应式。
 */

import type { ChangeHub } from './changes'
import { createRegistry, type RegistryApi } from './registry'
import type { Entry, Glyph, OverlayKind, SidebarRow, Unsubscribe } from './types'

// ---------- 条目类型（各区在通用 Entry 上的收窄） ----------

export type SidebarEntry<C> = Entry<C> & {
  /** 分节标题，零文案：不传就不渲染节头 */
  title?: string
  /** 折叠成 rail 时的替身 */
  icon?: Glyph
  rows: SidebarRow<C>[]
  // 分节组件席位：rows 为空且提供 component（继承自 Entry）时整节由组件渲染，
  // 折叠成 rail 时组件经 ViewProps.compact 自适配；rows 非空时行数据模型优先
}

export type ContentEntry<C> = Entry<C> & {
  /** 呈现于 Toolbar */
  title?: string
}

export type DetailEntry<C> = Entry<C> & {
  title: string
  icon?: Glyph
}

export type OverlayEntry<C> = Entry<C> & { kind: OverlayKind }

export type ToolbarEntry<C> = Entry<C> & { slot: 'leading' | 'trailing' }

export type PrefPageEntry<C> = Entry<C> & { title: string; icon?: Glyph }

export type PrefRowEntry<C> = Entry<C> & {
  /** 归属页 id，缺省归入壳自带"通用"页（契约定稿） */
  page?: string
}

// ---------- 各区 API ----------

export interface SidebarViewApi<C> {
  add(entry: SidebarEntry<C>): void
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly SidebarEntry<C>[]
  /** 顶部固定区席位（Logo、折叠按钮等），不随内容滚动，折叠成 rail 时仍渲染 */
  addHeader(entry: Entry<C>): void
  /** 底部固定区席位（固定操作行等），不随内容滚动 */
  addFooter(entry: Entry<C>): void
  readonly headers: readonly Entry<C>[]
  readonly footers: readonly Entry<C>[]
}

export interface ContentViewApi<C> {
  add(entry: ContentEntry<C>): void
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly ContentEntry<C>[]
  /** 活动条目：壳唯一写，由 Sidebar 行点击切换；初始 = order 最小条目 */
  readonly activeId: string | null
  /** 仅供壳的 Sidebar 行点击调用（壳唯一写） */
  activate(id: string): void
}

export interface DetailViewApi<C> {
  add(entry: DetailEntry<C>): void
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly DetailEntry<C>[]
  readonly shown: boolean
  readonly activeTabId: string | null
  /** 编程开合，缺省激活首个 tab */
  show(id?: string): void
  hide(): void
  /** 仅供壳的 tab 点击调用 */
  setActiveTab(id: string): void
}

export interface OverlayViewApi<C> {
  add(entry: OverlayEntry<C>): void
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly OverlayEntry<C>[]
}

export interface ToolbarViewApi<C> {
  add(entry: ToolbarEntry<C>): void
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly ToolbarEntry<C>[]
}

export interface PreferencesApi<C> {
  page(entry: PrefPageEntry<C>): void
  row(entry: PrefRowEntry<C>): void
  remove(id: string): void
  hasPage(id: string): boolean
  readonly pages: readonly PrefPageEntry<C>[]
  readonly rows: readonly PrefRowEntry<C>[]
  /** 壳机制：设置面板开合与页切换（壳唯一写） */
  open(): void
  close(): void
  readonly isOpen: boolean
  readonly activePageId: string
  setActivePage(id: string): void
}

// ---------- 实现 ----------

export function createSidebarView<C>(hub: ChangeHub): SidebarViewApi<C> {
  const registry = createRegistry<SidebarEntry<C>>(hub, 'Sidebar')
  const headerRegistry = createRegistry<Entry<C>>(hub, 'Sidebar Header')
  const footerRegistry = createRegistry<Entry<C>>(hub, 'Sidebar Footer')
  return {
    add: (entry) => {
      if (!Array.isArray(entry.rows)) {
        throw new Error(`Sidebar 条目 "${entry.id}" 缺少 rows（分节导航的行数据模型）`)
      }
      for (const row of entry.rows) {
        if (!row.id || !row.label) {
          throw new Error(`Sidebar 条目 "${entry.id}" 存在缺少 id / label 的行`)
        }
      }
      registry.add(entry)
    },
    remove: registry.remove,
    has: registry.has,
    // 必须 getter 转发：对象字面量里的 `entries: registry.entries` 会固化初始数组引用，
    // remove 换新数组后消费方将永远读到旧数据
    get entries() {
      return registry.entries
    },
    addHeader: (entry) => headerRegistry.add(entry),
    addFooter: (entry) => footerRegistry.add(entry),
    get headers() {
      return headerRegistry.entries
    },
    get footers() {
      return footerRegistry.entries
    },
  }
}

export function createContentView<C>(hub: ChangeHub): ContentViewApi<C> {
  const registry = createRegistry<ContentEntry<C>>(hub, 'Content')
  // null = 用户尚未选择：activeId 由 getter 动态回退到 order 最小条目（契约 §4），
  // 装配期不受注册顺序影响；activate 后固定为用户选择
  let activeId: string | null = null
  return {
    add: registry.add,
    remove: (id) => {
      registry.remove(id)
      // 移除的正是已固定的活动条目时，回退并固定到 order 最小条目
      if (activeId === id) {
        activeId = registry.entries[0]?.id ?? null
      }
    },
    has: registry.has,
    get entries() {
      return registry.entries
    },
    get activeId() {
      return activeId ?? registry.entries[0]?.id ?? null
    },
    activate(id) {
      if (!registry.has(id)) {
        throw new Error(`Content 不存在条目：${id}`)
      }
      activeId = id
      hub.bump()
    },
  }
}

export function createDetailView<C>(hub: ChangeHub): DetailViewApi<C> {
  const registry = createRegistry<DetailEntry<C>>(hub, 'Detail')
  let shown = false
  let activeTabId: string | null = null
  return {
    add: registry.add,
    remove: (id) => {
      registry.remove(id)
      if (activeTabId === id) {
        activeTabId = registry.entries[0]?.id ?? null
      }
    },
    has: registry.has,
    get entries() {
      return registry.entries
    },
    get shown() {
      return shown
    },
    get activeTabId() {
      return activeTabId
    },
    show(id) {
      // 先校验后赋值（对齐 setActiveTab）：非法 id 不得污染 activeTabId
      if (id && !registry.has(id)) {
        throw new Error(`Detail 不存在条目：${id}`)
      }
      activeTabId = id ?? registry.entries[0]?.id ?? null
      shown = true
      hub.bump()
    },
    hide() {
      shown = false
      hub.bump()
    },
    setActiveTab(id) {
      if (!registry.has(id)) {
        throw new Error(`Detail 不存在条目：${id}`)
      }
      activeTabId = id
      hub.bump()
    },
  }
}

export function createOverlayView<C>(hub: ChangeHub): OverlayViewApi<C> {
  const registry = createRegistry<OverlayEntry<C>>(hub, 'Overlay')
  return {
    add: (entry) => {
      if (entry.kind !== 'modal' && entry.kind !== 'banner') {
        throw new Error(`Overlay 条目 "${entry.id}" 的 kind 非法：${String(entry.kind)}`)
      }
      // modal 同时至多一个（互斥）；banner 可堆叠
      if (entry.kind === 'modal' && registry.entries.some((item) => item.kind === 'modal')) {
        throw new Error(`Overlay 已存在 modal 条目，modal 同时至多一个（冲突：${entry.id}）`)
      }
      registry.add(entry)
    },
    remove: registry.remove,
    has: registry.has,
    get entries() {
      return registry.entries
    },
  }
}

export function createToolbarView<C>(hub: ChangeHub): ToolbarViewApi<C> {
  const registry = createRegistry<ToolbarEntry<C>>(hub, 'Toolbar')
  return {
    add: (entry) => {
      if (entry.slot !== 'leading' && entry.slot !== 'trailing') {
        throw new Error(`Toolbar 条目 "${entry.id}" 的 slot 非法：${String(entry.slot)}`)
      }
      registry.add(entry)
    },
    remove: registry.remove,
    has: registry.has,
    get entries() {
      return registry.entries
    },
  }
}

/** 壳自带"通用"页 id（契约定稿：缺省 row 落入该页；零文案壳的契约内例外） */
export const GENERAL_PAGE_ID = 'general'

export function createPreferences<C>(hub: ChangeHub): PreferencesApi<C> {
  const pages = createRegistry<PrefPageEntry<C>>(hub, 'Preferences 页')
  const rows = createRegistry<PrefRowEntry<C>>(hub, 'Preferences 行')
  let isOpen = false
  let activePageId = GENERAL_PAGE_ID

  // 壳自带"通用"页：承接未指定 page 的行（契约第 4 节定稿）；齿轮图标为固有项视觉身份
  pages.add({
    id: GENERAL_PAGE_ID,
    title: '通用',
    icon: 'lucide:settings',
    // 壳自带页无内容组件，契约特例：置空由壳渲染空态
    component: null as unknown as C,
  })

  const api: PreferencesApi<C> = {
    page: (entry) => pages.add(entry),
    row: (entry) => rows.add(entry),
    remove: (id) => {
      if (id === GENERAL_PAGE_ID) {
        throw new Error('壳自带"通用"页不可移除')
      }
      if (pages.has(id)) {
        pages.remove(id)
        if (activePageId === id) {
          activePageId = GENERAL_PAGE_ID
        }
        return
      }
      rows.remove(id)
    },
    hasPage: pages.has,
    get pages() {
      return pages.entries
    },
    get rows() {
      return rows.entries
    },
    open() {
      isOpen = true
      hub.bump()
    },
    close() {
      isOpen = false
      hub.bump()
    },
    get isOpen() {
      return isOpen
    },
    get activePageId() {
      return activePageId
    },
    setActivePage(id) {
      if (!pages.has(id)) {
        throw new Error(`Preferences 不存在页：${id}`)
      }
      activePageId = id
      hub.bump()
    },
  }
  return api
}

/** 启动期校验结果使用；导出仅供 createApp 复核 */
export type { RegistryApi, Unsubscribe }
