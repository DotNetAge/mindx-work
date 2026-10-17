/**
 * experience 插件：Agent 经验库阅读页（会员全量库视角）。
 * 「经验」设置页（page 'experience'）：搜索 + 条目列表 + 正文阅读。
 * 数据源走 daemon 服务 market.experience.*（daemon 携带登录态代理访问，
 * 前端不持有 token）；未登录引导至「资源社区」页登录，不复制登录流程。
 * 与官网（人类只见官方文章与精选经验）视图分流：这里看到的是全量库。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import ExperiencePane from './ExperiencePane.vue'

const experiencePlugin: VuePlugin = (app) => {
  // 经验页：排在资源社区之后（设置导航定稿顺序：…→连接器→资源社区→经验）
  app.Settings.page({
    id: 'experience',
    title: '经验',
    icon: 'lucide:notebook-pen',
    order: 107,
    component: ExperiencePane,
  })
  app.Settings.row({ id: 'experience-pane', page: 'experience', component: ExperiencePane })
}

export default experiencePlugin
