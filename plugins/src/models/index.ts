/**
 * models 插件：模型供应商配置（"模型"设置页）。
 * 管理器以单个自定义行承载（market 的 MarketManageRow 先例）——
 * 上下结构：供应商品牌卡片横排 + 当前供应商模型列表（规格定稿，不照抄源组件左右双栏）。
 * 数据与 RPC 归 store（经 daemon.connection 服务调用 daemon）；
 * 不在注册期提供 models 服务：Pinia 注册期未安装，store 初始化必须由组件 setup 首触。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import ModelsManagerRow from './prefs/ModelsManagerRow.vue'

export const modelsPlugin: VuePlugin = (ctx) => {
  ctx.Settings.page({
    id: 'models',
    title: '模型',
    icon: 'lucide:cpu',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: ModelsManagerRow,
  })
  ctx.Settings.row({ id: 'models-manager', page: 'models', component: ModelsManagerRow })

  // 停用清理：席位移除（对齐 connection 插件先例）
  return () => {
    ctx.Settings.remove('models-manager')
    ctx.Settings.remove('models')
  }
}
