/**
 * dashboard（仪表板）插件：Detail「仪表板」tab + Sidebar 仪表板清单节。
 * 使命：Agent 按技能约定写 *.dash 布局 + data/*.json 数据 = 构建/更新用户
 * 界面（Agent-Driven UI）；本插件只读渲染，八类 Widget 白名单外拒绝。
 * services 提供 kanban.store 延迟外壳，供 chatflow / explorer 文件路由消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import SidebarSection from './SidebarSection.vue'
import AddToChat from './AddToChat.vue'
import { bindKanbanShell, createKanbanService, KANBAN_DETAIL_ID } from './store'

/** Sidebar 仪表板清单节 id */
export const KANBAN_SIDEBAR_SECTION_ID = 'kanban-sidebar-section'

export const kanbanPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindKanbanShell(ctx)

  // Detail：仪表板 tab（order 107，预置插件保留段 1–1000；openMax 拉出即满宽）
  ctx.Detail.add({
    id: KANBAN_DETAIL_ID,
    order: 107,
    title: '仪表板',
    icon: 'lucide:layout-dashboard',
    component: DetailPanel,
    openMax: true,
  })

  // Sidebar：仪表板清单节（rows 空数组 = 整节由组件渲染，壳契约要求字段存在）。
  // 折叠成 rail 时组件经 compact 自适配为刷新图标钮。
  ctx.Sidebar.add({
    id: KANBAN_SIDEBAR_SECTION_ID,
    order: 101,
    icon: 'lucide:layout-dashboard',
    component: SidebarSection,
    rows: [],
  })

  // DetailToolbar 尾段按钮（owner 归属本条目）：「添加到对话」（引用仪表板文件）
  ctx.Detail.addToolbar({
    id: 'kanban-detail-addchat',
    owner: KANBAN_DETAIL_ID,
    component: AddToChat,
  })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('kanban.store', createKanbanService())

  // 停用清理：席位移除 + 收起 Detail 轨道（若正展示本 tab）。
  // Sidebar 节无 remove API（chatflow 先例同），随应用生命周期常驻。
  return () => {
    if (ctx.Detail.activeTabId === KANBAN_DETAIL_ID) ctx.Detail.hide()
    ctx.Detail.remove(KANBAN_DETAIL_ID)
    ctx.Detail.removeToolbar('kanban-detail-addchat')
  }
}
