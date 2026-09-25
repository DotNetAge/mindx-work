declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // SFC 模块声明：插件包引用适配器 re-export 的 .vue 组件
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
