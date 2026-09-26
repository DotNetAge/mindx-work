/** Vue 适配器装配：provide 壳上下文 + Pinia + 宿主扩展 + 挂载 AppFrame */

import { createApp as createVueApp, type App } from 'vue'
import { createPinia } from 'pinia'
import AppFrame from './components/AppFrame.vue'
import { SHELL_KEY, type VueAppShell } from './reactivity'

export interface VueAppHandle {
  unmount(): void
}

/**
 * 挂载 Vue 适配器。
 * configure：宿主扩展钩子（Pinia 之后、mount 之前调用）——装配壳级全局能力
 * （如 app.use(ElementPlus)，组件库唯一装配点），保持本装配器与具体组件库解耦。
 */
export function mountVueApp(
  shell: VueAppShell,
  target: string | HTMLElement,
  configure?: (app: App) => void,
): VueAppHandle {
  const app = createVueApp(AppFrame)
  app.provide(SHELL_KEY, shell)
  // 插件内部状态一律 Pinia（界面层选型定稿）
  app.use(createPinia())
  configure?.(app)
  app.mount(target)
  return {
    unmount: () => app.unmount(),
  }
}
