/**
 * usage 插件：Token 用量仪表板（移植自 mindx-desktop TokenUsageReport）。
 * Content 主工作区视图承载月度汇总 + 当前会话明细（满高型页面），
 * Sidebar Footer 固定区提供入口行（排日历 90 之下、设置行 100 之上）。
 * 数据归组件：token.usage.monthly / token.usage.session.detail RPC
 * 经 daemon.connection（方法名以 mindx/internal/svc/handler_registry.go 注册表实证）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import UsageView from './UsageView.vue'
import UsageFooterRow from './UsageFooterRow.vue'
import { USAGE_FOOTER_ID, USAGE_VIEW_ID } from './ids'

export { USAGE_FOOTER_ID, USAGE_VIEW_ID }

export const usagePlugin: VuePlugin = (ctx) => {
  // Content：用量视图（title 由壳 Toolbar 呈现）
  ctx.Content.add({
    id: USAGE_VIEW_ID,
    order: 102,
    title: '用量',
    component: UsageView,
  })

  // Sidebar Footer 固定区：用量入口行（order 91：日历 90 之下、设置缺省 100 之上）
  ctx.Sidebar.addFooter({
    id: USAGE_FOOTER_ID,
    order: 91,
    component: UsageFooterRow,
  })

  // 停用清理：Content 席位移除（Sidebar footer 契约无移除通道，与 calendar 先例同式）
  return () => {
    ctx.Content.remove(USAGE_VIEW_ID)
  }
}
