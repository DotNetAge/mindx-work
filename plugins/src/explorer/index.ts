/**
 * explorer 插件：仅 Detail tab 席位（规格表拍板：无 Sidebar / Content）。
 * services 提供 explorer.store 延迟外壳，供 chatflow（文件路由）与
 * markdown / image-viewer（点击文件跳转互操作）消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import { bindExplorerShell, createExplorerService, EXPLORER_DETAIL_ID } from './store'

export const explorerPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindExplorerShell(ctx)

  // Detail：文件浏览 tab（order 101，预置插件保留段 1–1000）
  ctx.Detail.add({
    id: EXPLORER_DETAIL_ID,
    order: 101,
    title: '文件',
    icon: 'lucide:folder-open',
    component: DetailPanel,
  })

  // Toolbar 尾段：文件夹图标打开当前工作目录
  ctx.Toolbar.add({ id: 'explorer-toolbar-open', slot: 'trailing', order: 100, component: ToolbarTrailing })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('explorer.store', createExplorerService())

  // 停用清理：席位移除
  return () => {
    ctx.Toolbar.remove('explorer-toolbar-open')
  }
}
