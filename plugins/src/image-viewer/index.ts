/**
 * image-viewer 插件：仅 Detail tab 席位（规格表拍板：无 Sidebar / Content）。
 * services 提供 image-viewer.store 延迟外壳，供 chatflow / explorer 路由消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
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
  })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('image-viewer.store', createImageViewerService())

  return () => {}
}
