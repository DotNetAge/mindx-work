/**
 * 官方可选件运行期桥：把壳的运行时（Vue/Pinia/Element Plus 与绑定壳实例的
 * reactivity、原语组件）挂到 window.__MINDX_BRIDGE__，供 .agents/plugins/ 下
 * 构建的可选件 entry.mjs 运行期解构——可选件构建时这些依赖被外部化到桥，
 * 避免动态加载模块与壳产生双 Vue/Pinia 实例（响应式断裂）。
 * 桥面 = 全量命名空间（白名单实证不可维护：SFC 编译产物的成员消费面远超
 * 源码 import 面，缺成员即运行期 "xxx is not a function"）。
 */
import * as vue from 'vue'
import * as pinia from 'pinia'
import * as elementPlus from 'element-plus'
import { MxIcon, ToolbarIconButton, type VueAppShell } from './index'
import type { AppShell } from '@mindx-work/ui-shell'

/** 桥的运行期依赖（app/src/main.ts 装配期注入） */
export interface RuntimeBridgeDeps {
  shell: VueAppShell
  /** 绑定壳实例的 reactivity API（与 ui-shell-vue reactity.ts 同语义，闭包替代 inject） */
  useShell: () => VueAppShell
  useService: <T>(name: string) => T
}

export interface RuntimeBridge {
  shell: VueAppShell
  /** Vue 全量命名空间（运行期共享同一实例与响应式实现） */
  vue: typeof vue
  /** Pinia 全量命名空间（defineStore 产出的 store 挂在壳的同一 pinia 实例） */
  pinia: typeof pinia
  /** Element Plus 全量命名空间 */
  elementPlus: typeof elementPlus
  uiShellVue: {
    MxIcon: typeof MxIcon
    ToolbarIconButton: typeof ToolbarIconButton
    useShell: () => AppShell<unknown>
    useService: <T>(name: string) => T
  }
}

declare global {
  interface Window {
    /** 官方可选件运行期桥（installRuntimeBridge 挂载；可选件构建产物运行期解构） */
    __MINDX_BRIDGE__?: RuntimeBridge
  }
}

/** 挂载运行期桥（app 装配期调用一次，必须在任何可选件激活之前） */
export function installRuntimeBridge(deps: RuntimeBridgeDeps): void {
  const bridge: RuntimeBridge = {
    shell: deps.shell,
    vue,
    pinia,
    elementPlus,
    uiShellVue: {
      MxIcon,
      ToolbarIconButton,
      useShell: deps.useShell,
      useService: deps.useService,
    },
  }
  ;(window as Window & { __MINDX_BRIDGE__?: RuntimeBridge }).__MINDX_BRIDGE__ = bridge
}
