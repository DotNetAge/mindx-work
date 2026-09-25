declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // SFC 模块声明：供内核包内的 .ts 引用适配器的 .vue
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
