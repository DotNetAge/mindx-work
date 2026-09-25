/** 组装入口：执行预置插件清单 + 主题机制挂载 + 在线插件激活 + Vue 挂载 */

import { createApp } from '@mindx-work/ui-shell'
import { createThemeController, mountVueApp } from '@mindx-work/ui-shell-vue'
import { h } from 'vue'
import { demoPlugin, marketPlugin } from '@mindx-work/plugins'
import { createMarketRuntime, loadMarketPlugins } from './loader'

// 启动装配：插件冲突与依赖缺失在启动期暴露（契约第 7 节）
const shell = createApp([demoPlugin, marketPlugin])

// 主题机制归壳所有（军规 2/3）：控制器以服务形式供设置界面消费
shell.services.provide('shell.theme', createThemeController())

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
  mountVueApp(shell, '#app')
})()
