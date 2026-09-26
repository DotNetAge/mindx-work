/**
 * connection 插件：daemon 连接（"连接"设置页）。
 * 装配即建立本地 daemon 连接并以服务形式提供（daemon.connection）；
 * 设置页呈现连接方式（本期仅"本地"）与实时连接状态。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import ModeRow from './prefs/ModeRow.vue'
import StatusRow from './prefs/StatusRow.vue'
import { createDaemonConnection, DAEMON_CONNECTION_SERVICE } from './runtime'

export const connectionPlugin: VuePlugin = (ctx) => {
  const connection = createDaemonConnection()
  ctx.services.provide(DAEMON_CONNECTION_SERVICE, connection)

  // Settings：连接页（先于"模型"页——基础设施页 order 小者在前）
  ctx.Settings.page({
    id: 'connection',
    title: '连接',
    icon: 'lucide:plug',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: ModeRow,
  })
  ctx.Settings.row({ id: 'conn-mode', page: 'connection', component: ModeRow })
  ctx.Settings.row({ id: 'conn-status', page: 'connection', component: StatusRow })

  // 停用清理：席位移除 + 断开连接；配置保留（连接端点为固定常量，无持久化）
  return () => {
    ctx.Settings.remove('conn-mode')
    ctx.Settings.remove('conn-status')
    ctx.Settings.remove('connection')
    connection.dispose()
  }
}
