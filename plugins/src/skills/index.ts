/**
 * skills 插件：技能管理（"技能"设置页）。
 * 管理器以单个自定义行承载（models 的 ModelsManagerRow 先例）：本地全局库 + 在线市场双视图。
 * 数据与 RPC 归 store（经 daemon.connection 服务调用 daemon，含 skills_changed 热重载订阅）；
 * 不在注册期提供 skills 服务：Pinia 注册期未安装，store 初始化必须由组件 setup 首触。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import SkillsManagerRow from './prefs/SkillsManagerRow.vue'
import CredentialCollectModal from './overlays/CredentialCollectModal.vue'
import { MODAL_SKILL_CREDENTIAL_COLLECT } from './ids'
import { handleCollectNotification } from './collect'

export const skillsPlugin: VuePlugin = (ctx) => {
  ctx.Settings.page({
    id: 'skills',
    title: '技能',
    icon: 'lucide:sparkles',
    order: 104,
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: SkillsManagerRow,
  })
  ctx.Settings.row({ id: 'skills-manager', page: 'skills', component: SkillsManagerRow })

  // 凭据收集通知订阅（对齐 oauth 插件注册期订阅先例：技能准备流程不限于设置页
  // 触发，通知到达即弹收集框；has 去重防重复 add）
  const daemon = ctx.services.use<{ onNotification(method: string, cb: (params: unknown) => void): () => void }>(
    'daemon.connection',
  )
  const disposeCollect = daemon.onNotification('skill.credential_collect', (params) => {
    handleCollectNotification(params)
    if (!ctx.Overlay.has(MODAL_SKILL_CREDENTIAL_COLLECT)) {
      ctx.Overlay.add({ id: MODAL_SKILL_CREDENTIAL_COLLECT, kind: 'modal', component: CredentialCollectModal })
    }
  })

  // 停用清理：通知退订 + 席位移除（对齐 connection 插件先例）
  return () => {
    disposeCollect()
    ctx.Settings.remove('skills-manager')
    ctx.Settings.remove('skills')
  }
}
