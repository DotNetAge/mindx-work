/**
 * market 插件：市场聚合页 + 插件管理页。
 * 「市场」页（page 'market'）聚合 mindx 市场成员/技能/团队三类分发包货架与插件市场，
 * 顶部胶囊切换、标题右侧市场源信息与换源入口（MarketPaneRow）。
 * 「插件」页（page 'plugins'）保留内置/已安装插件管理（启停/切版/卸载，MarketManageRow）。
 * 动作归 useMarketStore，编排走壳命令 API；覆盖/安装确认走壳 Overlay modal。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import MarketManageRow from './prefs/MarketManageRow.vue'
import MarketPaneRow from './prefs/MarketPaneRow.vue'

const marketPlugin: VuePlugin = (app) => {
  // 市场聚合页：置于插件管理页之前注册（导航顺序随注册顺序）
  app.Settings.page({
    id: 'market',
    title: '市场',
    icon: 'lucide:store',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: MarketPaneRow,
  })
  app.Settings.row({ id: 'market-hub', page: 'market', component: MarketPaneRow })

  // 插件管理页（内置/已安装清单、启停、切版、卸载、导入导出）
  app.Settings.page({
    id: 'plugins',
    title: '插件管理',
    icon: 'lucide:puzzle',
    component: MarketManageRow,
  })
  app.Settings.row({ id: 'market-manage', page: 'plugins', component: MarketManageRow })
}

export default marketPlugin
