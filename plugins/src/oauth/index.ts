/**
 * oauth 插件：OAuth 提供商设置页 + 授权配合弹窗（阶段四壳侧授权配合界面）。
 * 授权流程由 daemon 侧 gochat 泛化实现执行，壳只负责呈现：oauth.present_*
 * 通知到达即弹授权弹窗（拉系统浏览器 / 展示用户码），oauth.flow_* 驱动
 * 收尾态。设置页「去授权」与技能准备流程（阶段五）共用同一通知通道。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import OAuthProvidersRow from './prefs/OAuthProvidersRow.vue'
import OAuthAuthorizeModal from './overlays/OAuthAuthorizeModal.vue'
import { MODAL_OAUTH_AUTHORIZE } from './ids'
import { handleFlowNotification } from './flow'

/** daemon 授权流程通知清单（呈现事件 + 收尾事件） */
const FLOW_METHODS = [
  'oauth.present_auth_url',
  'oauth.present_device_code',
  'oauth.present_user_code',
  'oauth.flow_completed',
  'oauth.flow_failed',
  'oauth.flow_cancelled',
] as const

export const oauthPlugin: VuePlugin = (ctx) => {
  ctx.Settings.page({
    id: 'oauth',
    title: 'OAuth 提供商',
    icon: 'lucide:key-round',
    // 契约要求 component 必填；设置页的行由壳渲染，页组件 v1 不消费
    component: OAuthProvidersRow,
  })
  ctx.Settings.row({ id: 'oauth-providers', page: 'oauth', component: OAuthProvidersRow })

  // 流程通知订阅（服务注册顺序：connection 先于本插件激活）；
  // 呈现事件到达即弹授权弹窗（设置页触发的弹窗已开，has 去重）
  const daemon = ctx.services.use<{ onNotification(method: string, cb: (params: unknown) => void): () => void }>(
    'daemon.connection',
  )
  const disposers = FLOW_METHODS.map((method) =>
    daemon.onNotification(method, (params) => {
      handleFlowNotification(method, params)
      if (method.startsWith('oauth.present_') && !ctx.Overlay.has(MODAL_OAUTH_AUTHORIZE)) {
        ctx.Overlay.add({ id: MODAL_OAUTH_AUTHORIZE, kind: 'modal', component: OAuthAuthorizeModal })
      }
    }),
  )

  // 停用清理：通知退订 + 席位移除
  return () => {
    disposers.forEach((dispose) => dispose())
    ctx.Settings.remove('oauth-providers')
    ctx.Settings.remove('oauth')
  }
}
