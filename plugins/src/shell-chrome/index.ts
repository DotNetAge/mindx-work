/**
 * shell-chrome 插件：侧栏固定区外壳（Header 品牌 + 折叠 / Footer 设置入口）
 * 与壳级通用配置（设置面板"通用"页四行：主题 / 语言 / 字号 / 版本，承接自 demo）。
 * demo 下线后由本插件承接壳级 chrome；零业务，仅壳机制入口。
 * Header/Footer 席位无移除通道（契约：仅 addHeader/addFooter），清理函数为空。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import ChromeHeader from './sidebar/ChromeHeader.vue'
import ChromeFooter from './sidebar/ChromeFooter.vue'
import UpdateBadge from './sidebar/UpdateBadge.vue'
import ThemeRow from './prefs/ThemeRow.vue'
import LanguageRow from './prefs/LanguageRow.vue'
import FontSizeRow from './prefs/FontSizeRow.vue'
import VersionRow from './prefs/VersionRow.vue'
import WizardRow from './prefs/WizardRow.vue'

export const shellChromePlugin: VuePlugin = (ctx) => {
  ctx.Sidebar.addHeader({ id: 'chrome-header', component: ChromeHeader })
  ctx.Sidebar.addFooter({ id: 'chrome-footer', component: ChromeFooter })
  // 更新图标（纯图标，仅在有更新时出现——组件内部自判空态；order 99：设置行 100 之下）
  ctx.Sidebar.addFooter({ id: 'chrome-update', order: 99, component: UpdateBadge })

  // "通用"页四行（缺省 page 自动归入壳自带通用页，注册序即显示序；承接 demo 原序）
  ctx.Settings.row({ id: 'chrome-pref-theme', component: ThemeRow })
  ctx.Settings.row({ id: 'chrome-pref-language', component: LanguageRow })
  ctx.Settings.row({ id: 'chrome-pref-font-size', component: FontSizeRow })
  ctx.Settings.row({ id: 'chrome-pref-version', component: VersionRow })
  ctx.Settings.row({ id: 'chrome-pref-wizard', component: WizardRow })

  // 契约第 7 节：返回清理函数；Header/Footer 无移除 API（同 demo 实证），空清理
  return () => {}
}
