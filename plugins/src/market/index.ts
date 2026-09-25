/**
 * market 插件：在线插件管理（"插件"设置页 = 已安装管理 + 市场浏览 + 安装确认）。
 * 页 id 'plugins'（demo 让位后归本插件）；动作走 useMarketStore，编排走壳命令 API。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import MarketManageRow from './prefs/MarketManageRow.vue'

const marketPlugin: VuePlugin = (app) => {
  app.Settings.page({
    id: 'plugins',
    title: '插件',
    icon: 'lucide:puzzle',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: MarketManageRow,
  })
  app.Settings.row({ id: 'market-manage', page: 'plugins', component: MarketManageRow })
}

export default marketPlugin
