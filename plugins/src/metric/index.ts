/**
 * metric 插件：决策量表的出网授权设置页（白皮书《决策量表》8.4 出网边界的壳侧呈现）。
 * 壳只负责授权状态的读写呈现（metric.consent.get/set）与同意书要点说明；
 * 市场评分上传接口依赖 mindx-market 项目化立项（当前市场为静态网站），
 * 本插件不包含任何上传逻辑——授权开关是未来上传路径的前置闸门。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import MetricConsentRow from './prefs/MetricConsentRow.vue'

export const metricPlugin: VuePlugin = (ctx) => {
  ctx.Settings.page({
    id: 'metric',
    title: '数据与隐私',
    icon: 'lucide:shield-check',
    order: 109,
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: MetricConsentRow,
  })
  ctx.Settings.row({ id: 'metric-consent', page: 'metric', component: MetricConsentRow })

  // 停用清理：席位移除
  return () => {
    ctx.Settings.remove('metric-consent')
    ctx.Settings.remove('metric')
  }
}
