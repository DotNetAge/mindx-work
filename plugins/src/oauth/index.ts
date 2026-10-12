/**
 * oauth 插件：授权配合弹窗（技能准备流程的壳侧呈现层）。
 * 授权流程由 daemon 侧 gochat 泛化实现执行，壳只负责呈现：oauth.present_*
 * 通知到达即弹授权弹窗（拉系统浏览器 / 展示用户码），oauth.flow_* 驱动
 * 收尾态。原「OAuth 提供商」设置页已摘除（内部配置不暴露给用户，
 * 2026-10-11 定案）；本插件仅保留技能准备流程必需的通知订阅与弹窗链路。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
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
  // 流程通知订阅（服务注册顺序：connection 先于本插件激活）；
  // 呈现事件到达即弹授权弹窗（已在途的弹窗用 has 去重）
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
  }
}
