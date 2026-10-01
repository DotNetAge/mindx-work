/**
 * docpreview 插件：仅 Detail tab 席位（同 image-viewer 范式：无 Sidebar / Content）。
 * services 提供 docpreview.store 延迟外壳，供 chatflow / explorer 扩展名路由消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import AddToChat from './AddToChat.vue'
import {
  bindDocPreviewShell,
  createDocPreviewService,
  DOC_PREVIEW_DETAIL_ID,
} from './store'

export const docPreviewPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindDocPreviewShell(ctx)

  // Detail：文档查看 tab（order 104，接 image-viewer 的 103；预置插件保留段 1–1000）
  ctx.Detail.add({
    id: DOC_PREVIEW_DETAIL_ID,
    order: 104,
    title: '文档',
    icon: 'lucide:file-text',
    component: DetailPanel,
  })

  // DetailToolbar 尾段按钮（owner 归属本条目）：「添加到对话」引用 chip
  ctx.Detail.addToolbar({ id: 'doc-preview-detail-addchat', owner: DOC_PREVIEW_DETAIL_ID, component: AddToChat })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('docpreview.store', createDocPreviewService())

  return () => {
    ctx.Detail.removeToolbar('doc-preview-detail-addchat')
  }
}
