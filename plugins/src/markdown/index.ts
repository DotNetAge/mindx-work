/**
 * markdown 插件：仅 Detail tab 席位（规格表拍板：无 Sidebar / Content）。
 * services 提供 markdown.store 延迟外壳，供 chatflow / explorer 路由消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import { bindMarkdownShell, createMarkdownService, MARKDOWN_DETAIL_ID } from './store'

export const markdownPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindMarkdownShell(ctx)

  // Detail：Markdown 查看/编辑 tab（order 102，预置插件保留段 1–1000）
  ctx.Detail.add({
    id: MARKDOWN_DETAIL_ID,
    order: 102,
    title: 'Markdown',
    icon: 'lucide:file-text',
    component: DetailPanel,
  })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('markdown.store', createMarkdownService())

  return () => {}
}
