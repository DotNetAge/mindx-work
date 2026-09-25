/** 适配器导出：类型收窄（C = Vue 组件）+ 渲染 + 主题机制 + 基础控件样式 */

import './styles/tokens.css'
import './styles/controls.css'

export { mountVueApp, type VueAppHandle } from './mountVueApp'
export { createThemeController, type ThemeController, type ThemeMode } from './theme'
export { createPreferencesController, type PreferencesController } from './preferences'
export {
  SHELL_KEY,
  useService,
  useShell,
  useShellData,
  useShellVersion,
  type VueAppShell,
  type VueComponent,
  type VuePlugin,
} from './reactivity'
export { default as MxIcon } from './MxIcon.vue'
