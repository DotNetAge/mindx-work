/**
 * agents 插件：数字员工管理（"数字员工"设置页）。
 * 管理器以单个自定义行承载（skills 的 SkillsManagerRow 先例）：
 * 团队视图（已招募员工卡片网格 + 下方配置面板，左右结构改上下结构）+ 在线市场双视图。
 * 数据与 RPC 归 store（经 daemon.connection 服务调用 daemon）；
 * 不在注册期提供 agents 服务：Pinia 注册期未安装，store 初始化必须由组件 setup 首触。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import AgentsManagerRow from './prefs/AgentsManagerRow.vue'

export const agentsPlugin: VuePlugin = (ctx) => {
  ctx.Settings.page({
    id: 'agents',
    title: '数字员工',
    icon: 'lucide:bot',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: AgentsManagerRow,
  })
  ctx.Settings.row({ id: 'agents-manager', page: 'agents', component: AgentsManagerRow })

  // 停用清理：席位移除（对齐 skills 插件先例）
  return () => {
    ctx.Settings.remove('agents-manager')
    ctx.Settings.remove('agents')
  }
}
