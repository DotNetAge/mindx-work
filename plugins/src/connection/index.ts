/**
 * connection 插件：daemon 连接运行时与设备接入请求弹窗。
 * 装配即按持久化模式建立 daemon 连接并以服务形式提供（daemon.connection）；
 * 设备接入请求（devgate.pair_request）的全局弹窗引擎随装配常驻启动。
 * 2026-10-11 设置页重构：「远程连接」设置页摘除，连接配置与设备管理并入
 * 「账户 - 设备」分组（market 插件承载），本插件只保留服务与全局弹窗。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import { createDaemonConnection, DAEMON_CONNECTION_SERVICE } from './runtime'
import { startDeviceGateEngine } from './devgate'

export const connectionPlugin: VuePlugin = (ctx) => {
  const connection = createDaemonConnection()
  ctx.services.provide(DAEMON_CONNECTION_SERVICE, connection)

  // 设备接入请求引擎（幂等启动；清理覆盖订阅/弹窗条目，契约第 7 节）
  const stopEngine = startDeviceGateEngine(ctx)

  // 停用清理：引擎退订 + 断开连接；连接配置持久化在宿主 preferences（保留）
  return () => {
    stopEngine()
    connection.dispose()
  }
}
