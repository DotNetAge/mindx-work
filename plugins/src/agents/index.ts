/**
 * agents 插件：团队管理（"团队"设置页）。
 * 管理器以单个自定义行承载（skills 的 SkillsManagerRow 先例）：
 * 团队视图（已招募员工卡片网格 + 下方配置面板，左右结构改上下结构）+ 在线市场双视图。
 * 数据与 RPC 归 store（经 daemon.connection 服务调用 daemon）。
 * 另提供 agents.registry 服务（插件间共享通道，契约 §5/§10.2：消费方以纯字符串名
 * useService 取用并本地声明形状，禁止跨插件 import）：延迟解析 daemon.connection
 * ——注册期 connection 插件可能尚未 provide，调用期（组件 setup 后）必已就绪。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import AgentsManagerRow from './prefs/AgentsManagerRow.vue'

/** agents.registry 服务名（消费方以纯字符串名引用，插件间禁止 import） */
export const AGENTS_REGISTRY_SERVICE = 'agents.registry'

/** agents.registry 服务结构契约：员工清单 + 团队清单的跨插件最小只读面 */
export interface AgentsRegistry {
  /** 员工全量清单（agent.list 原样返回，含 hired 标记；每次调用实时拉取） */
  list(): Promise<
    Array<{
      name: string
      role?: string
      description?: string
      icon?: string
      /** 是否已被招募（false 为缺省值） */
      hired?: boolean
    }>
  >
  /** 团队全量清单（team.list 原样返回，含 hired 标记与 leader 引用；每次调用实时拉取） */
  teams(): Promise<
    Array<{
      name: string
      nick_name?: string
      /** 负责人 Agent 名 */
      leader: string
      icon?: string
      /** 是否已雇佣（false 为缺省值） */
      hired?: boolean
    }>
  >
}

export const agentsPlugin: VuePlugin = (ctx) => {
  ctx.Settings.page({
    id: 'agents',
    title: '团队',
    icon: 'lucide:bot',
    order: 103,
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: AgentsManagerRow,
  })
  ctx.Settings.row({ id: 'agents-manager', page: 'agents', component: AgentsManagerRow })
  // 团队管理已融合进 agents-manager 行（成员与团队同列表混排、同配置面板骨架），
  // 独立"团队招聘"行按 2026-10-06 用户定稿删除

  // 跨插件共享面：员工清单 + 团队清单（chatflow 的 Agent 切换器消费）
  ctx.services.provide(AGENTS_REGISTRY_SERVICE, {
    list: () => ctx.services.use<{ call<T>(method: string, params?: unknown): Promise<T> }>('daemon.connection').call('agent.list', {}),
    teams: () => ctx.services.use<{ call<T>(method: string, params?: unknown): Promise<T> }>('daemon.connection').call('team.list', {}),
  } satisfies AgentsRegistry)

  // 停用清理：席位移除（对齐 skills 插件先例）
  return () => {
    ctx.Settings.remove('agents-manager')
    ctx.Settings.remove('teams-recruit')
    ctx.Settings.remove('agents')
  }
}
