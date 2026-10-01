/**
 * codeeditor 插件：仅 Detail tab 席位（同 markdown 范式：无 Sidebar / Content）。
 * services 提供 codeeditor.store 延迟外壳，供 chatflow 路由消费。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import { bindCodeEditorShell, createCodeEditorService, CODEEDITOR_DETAIL_ID } from './store'

export const codeEditorPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindCodeEditorShell(ctx)

  // Detail：代码文件编辑 tab（order 105，预置插件保留段 1–1000）
  ctx.Detail.add({
    id: CODEEDITOR_DETAIL_ID,
    order: 105,
    title: '代码',
    icon: 'lucide:file-code',
    component: DetailPanel,
    // 理想宽：代码行需要宽版面，激活时轨道拉宽（clamp 到平分上限）
    preferredWidth: 760,
  })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('codeeditor.store', createCodeEditorService())

  return () => {}
}
