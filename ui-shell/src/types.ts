/**
 * 壳级数据类型（渲染无关，见 docs/组件层契约.md）。
 * C 由适配器收窄为具体渲染类型（ui-shell-vue 收窄为 Vue 组件）。
 */

/** 壳级通用条目 */
export interface Entry<C> {
  /** 区内唯一，注册冲突启动期抛错 */
  id: string
  /** 排序权重，缺省 100，小者在前 */
  order?: number
  /** 对内核不透明，适配器负责解释与渲染 */
  component: C
}

/** 图标引用：Iconify 名称 "{collection}:{name}"，如 "lucide:settings"（军规 9） */
export type Glyph = string

/** 壳传给条目组件的 UI 事实：按视图区选用，宁可少传；业务数据不走 props */
export interface ViewProps {
  /** Content / Detail：当前是否呈现 */
  active?: boolean
  /** Sidebar：折叠成 rail */
  compact?: boolean
}

/** 全局浮层种类：modal（互斥）与 banner（可堆叠）；popover/sheet 归插件局部渲染 */
export type OverlayKind = 'modal' | 'banner'

/** Sidebar 行：数据模型而非组件，由壳统一渲染（SwiftUI selection 语义） */
export interface SidebarRow<C> {
  /** 必须对应一个 Content 条目 id，启动期校验 */
  id: string
  label: string
  icon?: Glyph
  /** 可选富元素：未读数、状态点 */
  badge?: C
  /**
   * 可选行形态：'button' 渲染为带边框的按钮卡（如 DSH "New Session"，
   * SidebarRoot.module.css L389-408：38 高 / 0.5px 边框 / radius 12 / elevated 填充）；
   * 缺省为普通导航行
   */
  variant?: 'button'
}

/** 插件间唯一共享通道；框架对实现零感知 */
export interface ServiceContext {
  /** 同名重复提供 = 编程错误，启动期抛出 */
  provide(name: string, impl: unknown): void
  /** 未提供时抛出——依赖缺失在启动期暴露 */
  use<T>(name: string): T
}

/** 插件 = 一个函数 + 一个可选清理函数 */
export type Plugin<C> = (app: AppShell<C>) => void | (() => void)

/** 结构变更订阅取消函数 */
export type Unsubscribe = () => void

/** AppShell 总面（完整接口见 createApp.ts，与装配实现同处） */
import type { AppShell } from './createApp'
export type { AppShell }
