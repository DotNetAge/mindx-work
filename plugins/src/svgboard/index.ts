/**
 * svgboard 插件：仅 Detail tab 席位（与 image-viewer 等查看器同范式）。
 * services 提供 svgboard.store 延迟外壳，供 chatflow / explorer 路由消费；
 * Toolbar 尾段提供"新建画板"入口（对齐 web-viewer 浏览器图标先例）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import AddToChat from './AddToChat.vue'
import {
  bindSvgboardShell,
  createSvgboardService,
  SVGBOARD_DETAIL_ID,
} from './store'

export const svgboardPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindSvgboardShell(ctx)

  // Detail：矢量画板 tab（order 106，预置插件保留段 1–1000；openMax 拉出即满宽）
  ctx.Detail.add({
    id: SVGBOARD_DETAIL_ID,
    order: 106,
    title: '画板',
    icon: 'lucide:pen-tool',
    component: DetailPanel,
    openMax: true,
  })

  // Toolbar 尾段：新建画板入口
  ctx.Toolbar.add({ id: 'svgboard-toolbar-open', slot: 'trailing', order: 102, component: ToolbarTrailing })

  // DetailToolbar 尾段按钮（owner 归属本条目）：「添加到对话」（先落盘再引用）
  ctx.Detail.addToolbar({ id: 'svgboard-detail-addchat', owner: SVGBOARD_DETAIL_ID, component: AddToChat })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('svgboard.store', createSvgboardService())

  // 停用清理：席位移除
  return () => {
    ctx.Toolbar.remove('svgboard-toolbar-open')
    ctx.Detail.removeToolbar('svgboard-detail-addchat')
  }
}
