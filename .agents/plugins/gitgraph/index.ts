/**
 * gitgraph 插件：读取当前工作目录 Git 记录，渲染提交拓扑图（Detail tab 席位，
 * order 108 紧随剪辑工作台）。数据经 Electron 宿主 pty 桥跑只读 git 命令
 * （白名单 log / branch / status / rev-parse，禁写操作，通道实证见
 * engine/gitSource.ts 头注）；拓扑布局为纯函数（engine/graphLayout）；
 * Toolbar 尾段提供入口图标（对齐 terminal 图标先例）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import GitGraphPanel from './GitGraphPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import { bindGitgraphShell, GITGRAPH_DETAIL_ID, useGitGraphStore } from './store'

export { GITGRAPH_DETAIL_ID } from './store'

export const gitgraphPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindGitgraphShell(ctx)

  // Detail：Git 图 tab（order 108，预置插件保留段 1–1000；剪辑 107 之后；openMax 拉出即满宽）
  ctx.Detail.add({
    id: GITGRAPH_DETAIL_ID,
    order: 108,
    title: 'Git 图',
    icon: 'lucide:git-branch',
    component: GitGraphPanel,
    openMax: true,
  })

  // Toolbar 尾段：Git 图入口（terminal 103 之后）
  ctx.Toolbar.add({ id: 'gitgraph-toolbar-open', slot: 'trailing', order: 104, component: ToolbarTrailing })

  // 停用清理：关闭活动 pty 会话 + 席位移除 + 收起 Detail 轨道（若正展示本 tab）
  return () => {
    try {
      useGitGraphStore().dispose()
    } catch {
      // store 从未实例化（插件停用前未被使用）时无需清理
    }
    if (ctx.Detail.activeTabId === GITGRAPH_DETAIL_ID) ctx.Detail.hide()
    ctx.Detail.remove(GITGRAPH_DETAIL_ID)
    ctx.Toolbar.remove('gitgraph-toolbar-open')
  }
}
