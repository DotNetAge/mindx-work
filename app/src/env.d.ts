/// <reference types="vite/client" />

/** 应用版本（vite define 构建时注入，取根 package.json version） */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** window.mxDesktop 宿主桥类型定稿在 @mindx-work/ui-shell/src/desktop-bridge.ts（唯一家） */
