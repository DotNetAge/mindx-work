/**
 * 内核可变结构 → Vue 响应式的薄桥：
 * 订阅壳版本号，组件经 useShellData 建立对壳数据读取的依赖。
 */

import { computed, inject, onUnmounted, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { AppShell } from '@mindx-work/ui-shell'
import type { Component } from 'vue'

/** 适配器收窄：条目组件 = Vue 组件 */
export type VueComponent = Component
export type VueAppShell = AppShell<VueComponent>
export type VuePlugin = (app: VueAppShell) => void | (() => void)

export const SHELL_KEY: InjectionKey<VueAppShell> = Symbol('shell-context')

/** 取壳上下文：必须在 mountVueApp 装配的组件树内使用 */
export function useShell(): VueAppShell {
  const shell = inject(SHELL_KEY)
  if (!shell) {
    throw new Error('壳上下文缺失：组件不在 mountVueApp 装配的组件树内')
  }
  return shell
}

/** 订阅壳结构版本，返回响应式版本号 */
export function useShellVersion(): Ref<number> {
  const shell = useShell()
  const version = ref(shell.version)
  const stop = shell.subscribe(() => {
    version.value = shell.version
  })
  onUnmounted(stop)
  return version
}

/** 建立对壳数据读取的响应式依赖：read 内访问壳的条目与壳状态 */
export function useShellData<T>(read: () => T): ComputedRef<T> {
  const version = useShellVersion()
  return computed(() => {
    // 先读版本号建立依赖，再读壳数据
    void version.value
    return read()
  })
}

/** 按名称消费服务（services 通道中流动的是 Pinia store 等响应式本体） */
export function useService<T>(name: string): T {
  return useShell().services.use<T>(name)
}
