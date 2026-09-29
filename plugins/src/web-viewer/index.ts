/**
 * web-viewer 插件：仅 Detail tab 席位（规格表拍板：无 Sidebar / Content）。
 * services 提供 web-viewer.store 延迟外壳，供 chatflow（消息内 URL 链接接管）消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import { bindWebViewerShell, createWebViewerService, WEB_VIEWER_DETAIL_ID } from './store'

export const webViewerPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindWebViewerShell(ctx)

  // Detail：网页浏览 tab（order 104，预置插件保留段 1–1000；openMax 拉出即满宽）
  ctx.Detail.add({
    id: WEB_VIEWER_DETAIL_ID,
    order: 104,
    title: '网页',
    icon: 'lucide:globe',
    component: DetailPanel,
    openMax: true,
  })

  // Toolbar 尾段：浏览器图标打开网页浏览
  ctx.Toolbar.add({ id: 'web-viewer-toolbar-open', slot: 'trailing', order: 101, component: ToolbarTrailing })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('web-viewer.store', createWebViewerService())

  // 停用清理：席位移除
  return () => {
    ctx.Toolbar.remove('web-viewer-toolbar-open')
  }
}
