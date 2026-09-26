/**
 * connectors 插件：MCP 连接器管理（"连接器"设置页）。
 * 管理器以单个自定义行承载（models 的 ModelsManagerRow 先例）。
 * 数据与 RPC 归 store（经 daemon.connection 服务调用 daemon）；
 * 不在注册期提供 connectors 服务：Pinia 注册期未安装，store 初始化必须由组件 setup 首触。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import ConnectorsManagerRow from './prefs/ConnectorsManagerRow.vue'

export const connectorsPlugin: VuePlugin = (ctx) => {
  ctx.Settings.page({
    id: 'connectors',
    title: '连接器',
    icon: 'lucide:plug',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: ConnectorsManagerRow,
  })
  ctx.Settings.row({ id: 'connectors-manager', page: 'connectors', component: ConnectorsManagerRow })

  // 停用清理：席位移除（对齐 connection 插件先例）
  return () => {
    ctx.Settings.remove('connectors-manager')
    ctx.Settings.remove('connectors')
  }
}
