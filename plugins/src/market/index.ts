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
import AccountPaneRow from './prefs/AccountPaneRow.vue'
import RatingShareRow from './prefs/RatingShareRow.vue'

const marketPlugin: VuePlugin = (app) => {
  // 账户页（§2.5）：绑定后的市场档案维护（显示名/头像/只读身份），未绑定引导至账号 Sheet
  app.Settings.page({
    id: 'account',
    title: '账户',
    icon: 'lucide:user-round',
    order: 100,
    component: AccountPaneRow,
  })
  app.Settings.row({ id: 'account-pane', page: 'account', component: AccountPaneRow })

  // 市场聚合页：显式 order 排在连接器之后（设置导航定稿顺序：插件→模型→团队→技能→连接器→市场）
  app.Settings.page({
    id: 'market',
    title: '市场',
    icon: 'lucide:store',
    order: 106,
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: MarketPaneRow,
  })
  app.Settings.row({ id: 'market-hub', page: 'market', component: MarketPaneRow })

  // 插件页（内置/已安装清单、启停、切版、卸载、导入导出）
  app.Settings.page({
    id: 'plugins',
    title: '插件',
    icon: 'lucide:puzzle',
    order: 101,
    component: MarketManageRow,
  })
  app.Settings.row({ id: 'market-manage', page: 'plugins', component: MarketManageRow })

  // 评分分享开关（§2.2）：不指定 page 归入壳自带「通用」页（隐私区）
  app.Settings.row({ id: 'market-rating-share', component: RatingShareRow })
}

export default marketPlugin
