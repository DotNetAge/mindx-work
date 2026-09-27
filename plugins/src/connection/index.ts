/**
 * connection 插件：daemon 连接（"连接"设置页）。
 * 装配即按持久化模式建立 daemon 连接并以服务形式提供（daemon.connection）；
 * 设置页呈现连接方式（本地/远程 Switch）+ 远程机器地址（仅远程）+ 手机连接。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import ModeRow from './prefs/ModeRow.vue'
import RemoteAddressRow from './prefs/RemoteAddressRow.vue'
import PhoneLinkRow from './prefs/PhoneLinkRow.vue'
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
  ctx.Settings.row({ id: 'conn-remote-url', page: 'connection', component: RemoteAddressRow })
  ctx.Settings.row({ id: 'conn-phone', page: 'connection', component: PhoneLinkRow })

  // 停用清理：席位移除 + 断开连接；配置保留（连接端点为固定常量，无持久化）
  return () => {
    ctx.Settings.remove('conn-mode')
    ctx.Settings.remove('conn-remote-url')
    ctx.Settings.remove('conn-phone')
    ctx.Settings.remove('connection')
    connection.dispose()
  }
}
