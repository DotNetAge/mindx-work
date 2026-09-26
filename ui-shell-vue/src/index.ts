/** 适配器导出：类型收窄（C = Vue 组件）+ 渲染 + 主题机制 + 基础控件样式 + Element Plus 壳单例供给 */

import './styles/tokens.css'
import './styles/controls.css'
// Element Plus 壳单例（军规：组件库唯一供给方）——样式顺序即优先级：
// 桥接表必须晚于 theme-chalk 加载（同为 :root 声明后者胜）；
// 官方暗色包 dark/css-vars.css 不引（挂 html.dark，与本壳 data-mx-theme 机制冲突且成双变量源）
import 'element-plus/dist/index.css'
import './styles/element-plus.css'

// EP 全量 re-export：插件统一从本包消费（直接 import 'element-plus' 在 pnpm 隔离下是幻影依赖）
export * from 'element-plus'
export { default as ElementPlus } from 'element-plus'
export { default as ElementPlusZhCn } from 'element-plus/es/locale/lang/zh-cn'

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
