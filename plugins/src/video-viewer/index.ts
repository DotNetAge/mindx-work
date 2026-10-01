/**
 * video-viewer 插件：仅 Detail tab 席位（规格表拍板：无 Sidebar / Content）。
 * services 提供 video-viewer.store 延迟外壳，供 chatflow / explorer 路由消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import AddToChat from './AddToChat.vue'
import {
  bindVideoViewerShell,
  createVideoViewerService,
  VIDEO_VIEWER_DETAIL_ID,
} from './store'

export const videoViewerPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindVideoViewerShell(ctx)

  // Detail：视频播放 tab（order 105，预置插件保留段 1–1000；openMax 拉出即满宽）
  ctx.Detail.add({
    id: VIDEO_VIEWER_DETAIL_ID,
    order: 105,
    title: '视频',
    icon: 'lucide:film',
    component: DetailPanel,
    openMax: true,
  })

  // DetailToolbar 尾段按钮（owner 归属本条目）：「添加到对话」引用 chip
  ctx.Detail.addToolbar({ id: 'video-viewer-detail-addchat', owner: VIDEO_VIEWER_DETAIL_ID, component: AddToChat })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('video-viewer.store', createVideoViewerService())

  return () => {
    ctx.Detail.removeToolbar('video-viewer-detail-addchat')
  }
}
