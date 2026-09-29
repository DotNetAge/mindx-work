/**
 * terminal 插件：Toolbar 尾段图标 + Detail tab 席位。
 * 终端呈现归渲染侧 xterm，pty 会话归 Electron 主进程（mx:terminal-* 桥）；
 * 纯 Web 环境无宿主桥，tab 打开后呈空容器（不裸抛，契约 §17 环境边界）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import TerminalPanel from './TerminalPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import { TERMINAL_DETAIL_ID, TERMINAL_TOOLBAR_ID } from './ids'

export { TERMINAL_DETAIL_ID } from './ids'

export const terminalPlugin: VuePlugin = (ctx) => {
  // Detail：终端 tab（order 107，预置插件保留段 1–1000；openMax 拉出即满宽）
  ctx.Detail.add({
    id: TERMINAL_DETAIL_ID,
    order: 107,
    title: '终端',
    icon: 'lucide:terminal',
    component: TerminalPanel,
    openMax: true,
  })

  // Toolbar 尾段：终端图标（order 103，explorer 100 / web-viewer 101 / chatflow 102 之后）
  ctx.Toolbar.add({ id: TERMINAL_TOOLBAR_ID, slot: 'trailing', order: 103, component: ToolbarTrailing })

  // 停用清理：席位移除 + 收起 Detail 轨道（若正展示本 tab；组件卸载自会杀会话）
  return () => {
    if (ctx.Detail.activeTabId === TERMINAL_DETAIL_ID) ctx.Detail.hide()
    ctx.Detail.remove(TERMINAL_DETAIL_ID)
    ctx.Toolbar.remove(TERMINAL_TOOLBAR_ID)
  }
}
