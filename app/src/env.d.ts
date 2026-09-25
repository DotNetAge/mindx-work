/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** window.mxDesktop 宿主桥类型定稿在 @mindx-work/ui-shell/src/desktop-bridge.ts（唯一家） */
