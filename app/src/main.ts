/** 组装入口：执行预置插件清单 + 主题机制挂载 + 在线插件激活 + Vue 挂载 */

import { createApp } from '@mindx-work/ui-shell'
import {
  createPreferencesController,
  createThemeController,
  ElementPlus,
  ElementPlusZhCn,
  mountVueApp,
} from '@mindx-work/ui-shell-vue'
import { h } from 'vue'
import { marketPlugin } from '@mindx-work/plugins'
import { createMarketRuntime, loadMarketPlugins } from './loader'
import { connectionPlugin } from '@mindx-work/plugins/connection'
import { modelsPlugin } from '@mindx-work/plugins/models'
import { connectorsPlugin } from '@mindx-work/plugins/connectors'
import { skillsPlugin } from '@mindx-work/plugins/skills'
import { agentsPlugin } from '@mindx-work/plugins/agents'
import { phonePairPlugin } from '@mindx-work/plugins/phone-pair'
import { shellChromePlugin } from '@mindx-work/plugins/shell-chrome'

// 启动装配：插件冲突与依赖缺失在启动期暴露（契约第 7 节）
// demo 插件已下线（源码保留作范式参考）：当前装配仅 market 插件
const shell = createApp([marketPlugin, connectionPlugin, modelsPlugin, connectorsPlugin, skillsPlugin, agentsPlugin, phonePairPlugin, shellChromePlugin])

// 设置持久化归壳所有：控制器以服务形式供设置行与插件消费（键建议 <owner>.<key> 前缀）
const preferences = createPreferencesController()
shell.services.provide('shell.preferences', preferences)

// 主题机制归壳所有（军规 2/3）：控制器以服务形式供设置界面消费；
// 档位持久化闭环也归壳——读回后恢复，变化即落盘（设置行零感知持久化）
const theme = createThemeController()
shell.services.provide('shell.theme', theme)
void preferences.ready.then(() => {
  const saved = preferences.get<'light' | 'dark' | 'auto' | null>('shell.theme.mode', null)
  if (saved) theme.setMode(saved)
})
theme.subscribe((mode) => {
  preferences.set('shell.theme.mode', mode)
})

// 在线插件运行期控制以服务形式供 market 插件消费（启停/切版/卸载先行停用）
const marketRuntime = createMarketRuntime(shell)
shell.services.provide('shell.market-runtime', marketRuntime)

/** 在线插件加载失败 banner：纯内容组件（卡片壳由 Overlay 容器提供），闭包捕获消息 */
function createFailureBanner(id: string, message: string) {
  return () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, [
      h('strong', `在线插件加载失败：${id}`),
      h('span', message),
    ])
}

// 在线插件：mount 前异步激活（失败隔离收集；整体异常也不阻塞壳首帧）
void (async () => {
  try {
    const failures = await loadMarketPlugins(shell, marketRuntime)
    for (const failure of failures) {
      console.error(`在线插件加载失败 [${failure.id}]：${failure.message}`)
      shell.Overlay.add({
        id: `market-failure-${failure.id}`,
        kind: 'banner',
        component: createFailureBanner(failure.id, failure.message),
      })
    }
  } catch (error) {
    console.error('在线插件加载异常：', error)
  }
  mountVueApp(shell, '#app', (vueApp) => {
    // Element Plus 壳单例装配（军规：组件库统一经 @mindx-work/ui-shell-vue 消费）：
    // zIndex 初值 3000 与既有 mx 层断带（壳 60/70、tooltip/menu 1100、插件 FLIP 2000/2001）
    vueApp.use(ElementPlus, { locale: ElementPlusZhCn, zIndex: 3000 })
  })
})()
