/**
 * demo 预置插件：一个函数填满六视图区（契约第 7 节插件义务）。
 * 零业务逻辑，仅验证壳的装配与编排。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import OverviewPage from './pages/OverviewPage.vue'
import TasksPage from './pages/TasksPage.vue'
import FilesPage from './pages/FilesPage.vue'
import SessionDetail from './SessionDetail.vue'
import UnreadBadge from './UnreadBadge.vue'
import FontSizeRow from './prefs/FontSizeRow.vue'
import LanguageRow from './prefs/LanguageRow.vue'
import ThemeRow from './prefs/ThemeRow.vue'
import VersionRow from './prefs/VersionRow.vue'
import { AgentRow, DesktopRow, ModelRow, PluginsRow } from './prefs/InfoRows'
import SidebarHeader from './sidebar/SidebarHeader.vue'
import SidebarFooter from './sidebar/SidebarFooter.vue'

const demoPlugin: VuePlugin = (app) => {
  // Toolbar 不注册席位：对齐 DSH 无通栏观感（折叠 / 设置入口收进 Sidebar Header / Footer）

  // Sidebar 固定区：Header（Logo + 折叠）/ Footer（固定操作行），不随内容滚动
  app.Sidebar.addHeader({ id: 'sidebar-header', component: SidebarHeader })
  app.Sidebar.addFooter({ id: 'sidebar-footer', component: SidebarFooter })

  // Sidebar：无标题首节（新会话按钮卡，对齐 DSH newSession 位置）+ 两节导航
  // （行 id 必须对应 Content 条目 id，启动期校验）
  app.Sidebar.add({
    id: 'section-new',
    order: 5,
    // 契约要求 Entry.component 必填；Sidebar 节的行由壳渲染，节组件 v1 不消费
    component: OverviewPage,
    rows: [{ id: 'overview', label: '新会话', icon: 'lucide:plus', variant: 'button' }],
  })
  app.Sidebar.add({
    id: 'section-work',
    order: 10,
    title: '工作台',
    icon: 'lucide:layout-grid',
    component: OverviewPage,
    rows: [{ id: 'tasks', label: '任务', icon: 'lucide:list-todo', badge: UnreadBadge }],
  })
  app.Sidebar.add({
    id: 'section-resource',
    order: 20,
    title: '资源',
    icon: 'lucide:folder',
    component: FilesPage,
    rows: [{ id: 'files', label: '文件', icon: 'lucide:folder-open' }],
  })

  // Content：三个页面，活动条目随 Sidebar 行切换
  app.Content.add({ id: 'overview', order: 10, title: '总览', component: OverviewPage })
  app.Content.add({ id: 'tasks', order: 20, title: '任务', component: TasksPage })
  app.Content.add({ id: 'files', order: 30, title: '文件', component: FilesPage })

  // Detail：一个 tab（show / hide 编程开合，入口在总览页）
  app.Detail.add({
    id: 'session-detail',
    title: '详情',
    icon: 'lucide:info',
    component: SessionDetail,
  })

  // Overlay：条目运行期经编排 API 注册（总览页触发），启动期不注册

  // Preferences：五页（对齐 DSH 设置导航结构），每页至少一行
  app.Settings.page({
    id: 'appearance',
    title: '外观',
    icon: 'lucide:sun-moon',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: ThemeRow,
  })
  app.Settings.page({ id: 'model', title: '模型', icon: 'lucide:bot', component: ModelRow })
  app.Settings.page({ id: 'plugins', title: '插件', icon: 'lucide:puzzle', component: PluginsRow })
  app.Settings.page({
    id: 'agent',
    title: 'Agent 预设',
    icon: 'lucide:bot-message-square',
    component: AgentRow,
  })
  app.Settings.page({
    id: 'desktop',
    title: '桌面设置',
    icon: 'lucide:monitor',
    component: DesktopRow,
  })
  app.Settings.row({ id: 'pref-theme', page: 'appearance', component: ThemeRow })
  app.Settings.row({ id: 'pref-language', component: LanguageRow })
  app.Settings.row({ id: 'pref-font-size', component: FontSizeRow })
  app.Settings.row({ id: 'pref-version', component: VersionRow })
}

export default demoPlugin
