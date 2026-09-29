/**
 * memory 插件：会话记忆管理器（移植自 mindx-desktop MemoryBrowser）。
 * Detail tab 席位承载管理界面（窄轨道单栏主从），Sidebar Footer 固定区提供
 * 入口行（与设置行同区、不随内容滚动，order 排日历行之下、设置行之上）；
 * 入口仅当当前会话存在记忆时可用（memory.list_by_session 计数），打开即当前
 * 会话内的记忆（agent 维度由会话归属天然限定）。
 * 数据归组件：memory.list_by_session / memory.update / memory.delete RPC 经
 * daemon.connection（daemon 实证方法名）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import MemoryPanel from './MemoryPanel.vue'
import MemoryFooterRow from './MemoryFooterRow.vue'

/** Detail tab 条目 id（index.ts 注册与 Footer 入口行跳转共用） */
export const MEMORY_DETAIL_ID = 'memory-detail'

/** Sidebar Footer 入口条目 id */
export const MEMORY_FOOTER_ID = 'memory-footer'

export const memoryPlugin: VuePlugin = (ctx) => {
  // Detail：记忆管理 tab（order 104，预置插件保留段 1–1000；explorer 101 / image-viewer 103）
  ctx.Detail.add({
    id: MEMORY_DETAIL_ID,
    order: 104,
    title: '记忆',
    icon: 'lucide:brain',
    component: MemoryPanel,
  })

  // Sidebar Footer 固定区：记忆入口行（order 91：设置 100 之上、日历 90 之下）
  ctx.Sidebar.addFooter({
    id: MEMORY_FOOTER_ID,
    order: 91,
    component: MemoryFooterRow,
  })

  // 停用清理：席位移除 + 收起 Detail 轨道（若正展示本 tab）。
  // Footer 无移除通道（契约仅 addFooter），入口行随插件模块卸载自然消失
  return () => {
    if (ctx.Detail.activeTabId === MEMORY_DETAIL_ID) ctx.Detail.hide()
    ctx.Detail.remove(MEMORY_DETAIL_ID)
  }
}
