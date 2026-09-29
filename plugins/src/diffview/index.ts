/**
 * diffview 插件：会话文件变更审看器（Detail tab + Sidebar Footer 入口行）。
 * Detail tab 承载待确认变更的集中审看与确认/回退操作（DiffPanel），Sidebar
 * Footer 固定区提供入口行（order 92：记忆 91 之下、设置 100 之上）；入口仅当
 * 当前会话存在待确认变更时可用。数据与动作归 chatflow（session.confirm_files /
 * session.rollback_files RPC 由 chatflow.store 服务内聚），本插件纯 UI + 联动
 * （对话流经 store.diffFocusPath 跳转定位）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DiffPanel from './DiffPanel.vue'
import DiffFooterRow from './DiffFooterRow.vue'

/** Detail tab 条目 id（index.ts 注册与 Footer 入口行跳转共用） */
export const DIFF_DETAIL_ID = 'diff-detail'

/** Sidebar Footer 入口条目 id */
export const DIFF_FOOTER_ID = 'diff-footer'

export const diffviewPlugin: VuePlugin = (ctx) => {
  // Detail：文件变更审看 tab（order 105，预置插件保留段 1–1000；memory 104 之后）
  ctx.Detail.add({
    id: DIFF_DETAIL_ID,
    order: 105,
    title: '变更',
    icon: 'lucide:git-compare',
    component: DiffPanel,
  })

  // Sidebar Footer 固定区：变更入口行（order 92：记忆 91 之下、设置 100 之上）
  ctx.Sidebar.addFooter({
    id: DIFF_FOOTER_ID,
    order: 92,
    component: DiffFooterRow,
  })

  // 停用清理：席位移除 + 收起 Detail 轨道（若正展示本 tab）
  return () => {
    if (ctx.Detail.activeTabId === DIFF_DETAIL_ID) ctx.Detail.hide()
    ctx.Detail.remove(DIFF_DETAIL_ID)
  }
}
