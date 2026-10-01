/**
 * image-viewer 插件：仅 Detail tab 席位（规格表拍板：无 Sidebar / Content）。
 * services 提供 image-viewer.store 延迟外壳，供 chatflow / explorer 路由消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import AddToChat from './AddToChat.vue'
import {
  bindImageViewerShell,
  createImageViewerService,
  IMAGE_VIEWER_DETAIL_ID,
} from './store'

export const imageViewerPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindImageViewerShell(ctx)

  // Detail：图片查看 tab（order 103，预置插件保留段 1–1000）
  ctx.Detail.add({
    id: IMAGE_VIEWER_DETAIL_ID,
    order: 103,
    title: '图片',
    icon: 'lucide:image',
    component: DetailPanel,
    // 理想宽：图片不需要全宽版面，激活时从宽层切回收窄
    preferredWidth: 460,
  })

  // DetailToolbar 尾段按钮（owner 归属本条目）：「添加到对话」引用 chip
  ctx.Detail.addToolbar({ id: 'image-viewer-detail-addchat', owner: IMAGE_VIEWER_DETAIL_ID, component: AddToChat })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('image-viewer.store', createImageViewerService())

  // 文件类型接管：图片扩展名 → 本插件（打开路由动态注册表）
  const unregisterFileTypes = ctx.fileTypes.register(
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
    'image-viewer.store',
  )

  return () => {
    unregisterFileTypes()
    ctx.Detail.removeToolbar('image-viewer-detail-addchat')
  }
}
