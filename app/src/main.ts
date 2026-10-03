/** 组装入口：执行预置插件清单 + 主题机制挂载 + 在线插件激活 + Vue 挂载 */

import { createApp, PLUGIN_CATALOG_SERVICE, type CorePluginInfo } from '@mindx-work/ui-shell'
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
import { oauthPlugin } from '@mindx-work/plugins/oauth'
import { modelsPlugin } from '@mindx-work/plugins/models'
import { connectorsPlugin } from '@mindx-work/plugins/connectors'
import { skillsPlugin } from '@mindx-work/plugins/skills'
import { agentsPlugin } from '@mindx-work/plugins/agents'
import { phonePairPlugin } from '@mindx-work/plugins/phone-pair'
import { shellChromePlugin } from '@mindx-work/plugins/shell-chrome'
import { chatflowPlugin } from '@mindx-work/plugins/chatflow'
import { explorerPlugin } from '@mindx-work/plugins/explorer'
import { markdownPlugin } from '@mindx-work/plugins/markdown'
import { codeEditorPlugin } from '@mindx-work/plugins/codeeditor'
import { imageViewerPlugin } from '@mindx-work/plugins/image-viewer'
import { docPreviewPlugin } from '@mindx-work/plugins/docpreview'
import { webViewerPlugin } from '@mindx-work/plugins/web-viewer'
import { videoViewerPlugin } from '@mindx-work/plugins/video-viewer'
import { svgboardPlugin } from '@mindx-work/plugins/svgboard'
import { videoEditorPlugin } from '@mindx-work/plugins/video-editor'
import { gitgraphPlugin } from '@mindx-work/plugins/gitgraph'
import { dashboardPlugin } from '@mindx-work/plugins/dashboard'
import { terminalPlugin } from '@mindx-work/plugins/terminal'
import { calendarPlugin } from '@mindx-work/plugins/calendar'
import { usagePlugin } from '@mindx-work/plugins/usage'
import { memoryPlugin } from '@mindx-work/plugins/memory'
import { diffviewPlugin } from '@mindx-work/plugins/diffview'

// 启动装配：插件冲突与依赖缺失在启动期暴露（契约第 7 节）
// demo 插件已下线（源码保留作范式参考）：当前装配仅 market 插件
// 清单顺序即设置导航顺序（壳自带「通用」恒居首）：插件 → 模型 → 团队 → 技能 → 连接器 → 连接 → OAuth 提供商
// oauth 消费 daemon.connection 服务，必须排在 connection 之后（use 非惰性，缺失即抛）
const shell = createApp([marketPlugin, modelsPlugin, agentsPlugin, skillsPlugin, connectorsPlugin, connectionPlugin, oauthPlugin, phonePairPlugin, shellChromePlugin, chatflowPlugin, explorerPlugin, markdownPlugin, codeEditorPlugin, imageViewerPlugin, docPreviewPlugin, webViewerPlugin, videoViewerPlugin, svgboardPlugin, videoEditorPlugin, gitgraphPlugin, dashboardPlugin, terminalPlugin, calendarPlugin, usagePlugin, memoryPlugin, diffviewPlugin])

// 预置插件目录（全量视图数据源）：装配处是唯一知道插件清单的地方，经 services
// 提供给 market 插件的「已安装」视图（运行期消费——market store 初始化晚于此 provide）
const CORE_PLUGINS: CorePluginInfo[] = [
  { id: 'market', name: '插件', description: '插件市场与已安装插件管理' },
  { id: 'models', name: '模型', description: '模型供应商与模型配置' },
  { id: 'agents', name: '团队', description: '智能体团队管理' },
  { id: 'skills', name: '技能', description: '技能库管理' },
  { id: 'connectors', name: '连接器', description: '连接器配置' },
  { id: 'oauth', name: 'OAuth 提供商', description: 'OAuth 授权提供商配置与授权' },
  { id: 'connection', name: '连接', description: '智能主机连接状态与诊断' },
  { id: 'phone-pair', name: '设备配对', description: '手机设备扫码配对' },
  { id: 'shell-chrome', name: '壳工具栏', description: '窗口工具栏与全局动作' },
  { id: 'chatflow', name: '任务', description: '任务对话工作流' },
  { id: 'explorer', name: '文件', description: '工作区文件浏览' },
  { id: 'markdown', name: 'Markdown 预览', description: 'Markdown 渲染查看' },
  { id: 'codeeditor', name: '代码编辑', description: '源码编辑器' },
  { id: 'image-viewer', name: '图片查看', description: '图片查看器' },
  { id: 'docpreview', name: '文档预览', description: 'Office 等文档格式预览' },
  { id: 'web-viewer', name: '网页查看', description: '内嵌网页浏览' },
  { id: 'video-viewer', name: '视频播放', description: '视频播放器' },
  { id: 'svgboard', name: 'SVG 画板', description: 'SVG 矢量画板' },
  { id: 'gitgraph', name: 'Git 图', description: 'Git 提交拓扑图' },
  { id: 'dashboard', name: '仪表盘', description: '数据仪表盘' },
  { id: 'terminal', name: '终端', description: '集成终端' },
  { id: 'calendar', name: '日历', description: '日历视图' },
  { id: 'usage', name: '用量', description: '模型用量统计' },
  { id: 'memory', name: '记忆', description: '智能体记忆库' },
  { id: 'diffview', name: '差异对比', description: '文件差异对比视图' },
]
shell.services.provide(PLUGIN_CATALOG_SERVICE, CORE_PLUGINS)

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
