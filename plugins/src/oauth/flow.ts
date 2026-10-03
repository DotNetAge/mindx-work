/**
 * 授权流程状态单例：daemon 侧 gochat 流程经 oauth.present_* / oauth.flow_*
 * 通知驱动。设置页「去授权」与技能准备流程（阶段五）共用同一通知通道——
 * daemon 先起流程、呈现事件到达即弹授权弹窗，弹窗只是流程状态的视图。
 * 模块级 reactive 单例（对齐 connection/channel.ts 先例），弹窗与行共享。
 */

import { reactive, ref } from 'vue'

export type OAuthFlowPhase = 'connecting' | 'waiting' | 'success' | 'failed' | 'cancelled'
export type OAuthInteraction = 'callback' | 'device_code' | 'user_code'

/** 提供商列表版本号：配置弹窗保存后自增，设置行 watch 后刷新（跨组件刷新通道） */
export const oauthProvidersVersion = ref(0)

/** 配置弹窗目标（第二层模板 client_id 填入） */
export const oauthConfigureTarget = reactive({ name: '', title: '' })

export interface OAuthFlowState {
  /** 流程在途（弹窗以 phase 呈现各态） */
  active: boolean
  provider: string
  title: string
  interaction: OAuthInteraction | null
  /** callback：授权链接（壳拉系统浏览器） */
  authUrl: string
  /** device_code / user_code：用户码与验证网址 */
  userCode: string
  verifyUrl: string
  /** device_code：设备码有效期（秒） */
  expiresIn: number
  phase: OAuthFlowPhase
  error: string
}

export const oauthFlow = reactive<OAuthFlowState>({
  active: false,
  provider: '',
  title: '',
  interaction: null,
  authUrl: '',
  userCode: '',
  verifyUrl: '',
  expiresIn: 0,
  phase: 'connecting',
  error: '',
})

/** 每流程只自动打开一次浏览器（present_* 可能重放，防重复拉起） */
let openedUrl = ''

/** 重置并进入连接态（行点击「去授权」时调用，弹窗挂载后发起 RPC） */
export function beginFlow(provider: string, title: string): void {
  openedUrl = ''
  oauthFlow.active = true
  oauthFlow.provider = provider
  oauthFlow.title = title
  oauthFlow.interaction = null
  oauthFlow.authUrl = ''
  oauthFlow.userCode = ''
  oauthFlow.verifyUrl = ''
  oauthFlow.expiresIn = 0
  oauthFlow.phase = 'connecting'
  oauthFlow.error = ''
}

/** 弹窗关闭/流程结束后的状态清理（active=false 使迟到事件被忽略） */
export function endFlow(): void {
  oauthFlow.active = false
  oauthFlow.phase = 'connecting'
}

/** 系统浏览器打开链接（Electron 宿主桥优先，纯 Web 降级新窗口） */
function openExternal(url: string): void {
  if (window.mxDesktop?.openExternal) {
    void window.mxDesktop.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}

function openOnce(url: string): void {
  if (!url || openedUrl === url) return
  openedUrl = url
  openExternal(url)
}

function startPresent(provider: string, title: string, interaction: OAuthInteraction): void {
  // 技能准备流程（阶段五）发起时无 beginFlow 前置：呈现事件即流程在途信号
  if (!oauthFlow.active || oauthFlow.provider !== provider) {
    openedUrl = ''
    oauthFlow.active = true
    oauthFlow.provider = provider
    oauthFlow.phase = 'waiting'
    oauthFlow.error = ''
  }
  oauthFlow.title = title || provider
  oauthFlow.interaction = interaction
}

/** 通知分发（index.ts 订阅转发）：method ∈ oauth.present_* / oauth.flow_* */
export function handleFlowNotification(method: string, params: unknown): void {
  const data = (params as { data?: Record<string, unknown> } | null)?.data ?? {}
  const provider = typeof data.provider === 'string' ? data.provider : ''
  const title = typeof data.title === 'string' ? data.title : ''

  switch (method) {
    case 'oauth.present_auth_url':
      startPresent(provider, title, 'callback')
      oauthFlow.authUrl = String(data.url ?? '')
      openOnce(oauthFlow.authUrl)
      break
    case 'oauth.present_device_code':
      startPresent(provider, title, 'device_code')
      oauthFlow.userCode = String(data.user_code ?? '')
      oauthFlow.verifyUrl = String(data.verify_url ?? '')
      oauthFlow.expiresIn = Number(data.expires_in ?? 0)
      openOnce(oauthFlow.verifyUrl)
      break
    case 'oauth.present_user_code':
      startPresent(provider, title, 'user_code')
      oauthFlow.userCode = String(data.user_code ?? '')
      oauthFlow.verifyUrl = String(data.verify_url ?? '')
      openOnce(oauthFlow.verifyUrl)
      break
    case 'oauth.flow_completed':
      if (!oauthFlow.active) break
      oauthFlow.phase = 'success'
      break
    case 'oauth.flow_failed':
      if (!oauthFlow.active) break
      oauthFlow.phase = 'failed'
      oauthFlow.error = String(data.error ?? '授权失败')
      break
    case 'oauth.flow_cancelled':
      if (!oauthFlow.active) break
      oauthFlow.phase = 'cancelled'
      break
  }
}
