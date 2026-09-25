/** Vue 适配器装配：provide 壳上下文 + Pinia + 挂载 AppFrame */

import { createApp as createVueApp } from 'vue'
import { createPinia } from 'pinia'
import AppFrame from './components/AppFrame.vue'
import { SHELL_KEY, type VueAppShell } from './reactivity'

export interface VueAppHandle {
  unmount(): void
}

export function mountVueApp(shell: VueAppShell, target: string | HTMLElement): VueAppHandle {
  const app = createVueApp(AppFrame)
  app.provide(SHELL_KEY, shell)
  // 插件内部状态一律 Pinia（界面层选型定稿）
  app.use(createPinia())
  app.mount(target)
  return {
    unmount: () => app.unmount(),
  }
}
