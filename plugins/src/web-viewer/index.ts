/**
 * web-viewer 插件：仅 Detail tab 席位（规格表拍板：无 Sidebar / Content）。
 * services 提供 web-viewer.store 延迟外壳，供 chatflow（消息内 URL 链接接管）消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import AddToChat from './AddToChat.vue'
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

  // DetailToolbar 尾段按钮（owner 归属本条目）：「添加到对话」引用 chip
  ctx.Detail.addToolbar({ id: 'web-viewer-detail-addchat', owner: WEB_VIEWER_DETAIL_ID, component: AddToChat })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）；
  // 导航兜底消费（Electron 宿主拦截的 mx:open-url 回发）复用同一外壳——壳惰性
  // 解析且底层 Pinia store 按 id 单例，provide 与闭包共享不产生多余实例。
  const service = createWebViewerService()
  ctx.services.provide('web-viewer.store', service)
  const disposeGuard = window.mxDesktop?.onOpenUrl((url) => {
    service.store.open(url)
  })

  // link_open 订阅：Agent-Driven UI 命令（mindx ui open-link）走系统浏览器——
  // 授权登录等场景目标站拒绝 iframe 嵌入（X-Frame-Options），不能落 web-viewer。
  // 无宿主桥（纯 Web）降级新窗口打开；服务注册顺序：connection 先于本插件激活。
  const daemon = ctx.services.use<{ onNotification(method: string, cb: (params: unknown) => void): () => void }>(
    'daemon.connection'
  )
  const disposeLinkOpen = daemon.onNotification('link_open', (params) => {
    const url = (params as { data?: { url?: unknown } } | null)?.data?.url
    if (typeof url !== 'string' || !url) return
    if (window.mxDesktop?.openExternal) {
      void window.mxDesktop.openExternal(url)
      return
    }
    window.open(url, '_blank', 'noopener')
  })

  // 停用清理：席位 + 兜底订阅 + link_open 订阅退订
  return () => {
    ctx.Toolbar.remove('web-viewer-toolbar-open')
    ctx.Detail.removeToolbar('web-viewer-detail-addchat')
    disposeGuard?.()
    disposeLinkOpen()
  }
}
