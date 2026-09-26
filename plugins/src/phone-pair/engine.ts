/**
 * 手机连接引擎（模块级常驻单例）：mindx-desktop PhonePairDialogs.vue（挂 App.vue 的全局
 * 编排组件）与 useChannelStatus.ts（单例轮询/订阅）的整体映射。
 * desktop 侧二者共用模块级状态且应用生命周期常驻；mindx-work 无常驻组件席位，
 * 引擎在插件激活时启动（装配即常驻），弹窗经壳 Overlay 席位呈现（不依赖设置页开合）。
 * 编排链路（对齐蓝本）：
 * - channel.pair_request（通知到达，轮询以 pending_request 兜底）→ 同意/拒绝确认弹窗；
 * - channel.approve / channel.deny → daemon 签发并广播；
 * - channel.pair_approved → 关确认弹窗、展示大号短码（倒计时归零自动关闭）；
 * - channel.pair_completed → 关短码弹窗并提示成功。
 */

import { ref, watch } from 'vue'
import type { useShell } from '@mindx-work/ui-shell-vue'
import { MODAL_PHONE_PAIR_CODE, MODAL_PHONE_PAIR_REQUEST } from './ids'
import { pushNotice } from './notice'
import type { ChannelPairRequest, ChannelStatus } from './types'
import PairRequestModal from './overlays/PairRequestModal.vue'
import PairCodeModal from './overlays/PairCodeModal.vue'

/** useShell 返回的壳上下文类型 */
type Shell = ReturnType<typeof useShell>

/** 服务以纯字符串名消费（插件间禁止 import；契约 §10.2） */
const DAEMON_CONNECTION = 'daemon.connection'
/** 轮询周期（蓝本 useChannelStatus：3s） */
const POLL_INTERVAL = 3000

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

// ── 模块级单例状态（蓝本 useChannelStatus 同构：应用生命周期常驻，不随组件卸载） ──
/** 通道状态摘要（轮询刷新） */
export const channelStatus = ref<ChannelStatus | null>(null)
/** 最新待审批的配对请求（通知与轮询双通道汇入，消费后置空） */
export const pairRequest = ref<ChannelPairRequest | null>(null)
/** 配对短码（pair_approved 触发） */
export const gateCode = ref('')
/** 短码有效期秒数（短码弹窗倒计时初值） */
export const gateExpiresIn = ref(0)

let started = false
let shellRef: Shell | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let stopWatch: (() => void) | null = null
let offNotify: (() => void) | null = null
/** 已弹过确认弹窗的请求 id（防同一请求重复弹窗，蓝本 approvingId 同款） */
let approvingId = ''

/** overlay modal 互斥惯例：同 id 先 has 再 remove（既有的先 remove 再 add 写法收敛为助手） */
function removeOverlayIfPresent(shell: Shell, id: string): void {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
}

/** 轮询通道状态（蓝本 refresh 同构）：失败静默等下一轮；pending_request 兜底补齐错过的通知 */
async function refresh(): Promise<void> {
  const shell = shellRef
  if (!shell) return
  const daemon = shell.services.use<DaemonConnection>(DAEMON_CONNECTION)
  try {
    channelStatus.value = await daemon.call<ChannelStatus>('channel.status', {})
    // 兜底：通知可能早于消费到达，以服务端 pending 态补齐
    if (channelStatus.value?.pending_request && !pairRequest.value) {
      pairRequest.value = channelStatus.value.pending_request
    }
  } catch {
    // 未连接或通道未启用，静默等下一轮
  }
}

/** 同意当前配对请求：daemon 签发短码并广播 pair_approved（短码弹窗由通知驱动呈现） */
export async function approveChannelRequest(): Promise<void> {
  const shell = shellRef
  const req = pairRequest.value
  if (!shell || !req) return
  const daemon = shell.services.use<DaemonConnection>(DAEMON_CONNECTION)
  try {
    await daemon.call('channel.approve', { request_id: req.request_id })
    pushNotice(shell, 'success', '已同意，请在手机上输入短码完成配对')
  } catch (error) {
    pushNotice(shell, 'error', error instanceof Error ? error.message : String(error))
  } finally {
    // 确认弹窗使命完成（pair_approved 到达时引擎已先行切换，幂等）
    removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_REQUEST)
    clearPairRequest(req.request_id)
  }
}

/** 拒绝当前配对请求：请求在 TTL 内失效（调用失败静默，蓝本同款） */
export async function denyChannelRequest(): Promise<void> {
  const shell = shellRef
  const req = pairRequest.value
  if (!shell || !req) return
  const daemon = shell.services.use<DaemonConnection>(DAEMON_CONNECTION)
  try {
    await daemon.call('channel.deny', { request_id: req.request_id })
  } catch {
    // daemon 侧拒绝失败不阻断本地流程（请求超时后自动失效）
  }
  pushNotice(shell, 'info', '已拒绝该手机的连接请求')
  removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_REQUEST)
  clearPairRequest(req.request_id)
}

/** 消费指定请求（同意/拒绝处理后调用，避免重复弹窗；蓝本 clearPairRequest 同构） */
export function clearPairRequest(requestId?: string): void {
  if (!requestId || pairRequest.value?.request_id === requestId) {
    pairRequest.value = null
  }
}

/** 收到配对请求：弹出同意/拒绝确认弹窗（壳 modal 互斥，先 remove 再 add） */
function presentRequestModal(shell: Shell): void {
  removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_REQUEST)
  shell.Overlay.add({ id: MODAL_PHONE_PAIR_REQUEST, kind: 'modal', component: PairRequestModal })
}

/** 收到 pair_approved：关确认弹窗，展示大号短码（倒计时归零由弹窗组件自关） */
function presentCodeModal(shell: Shell, code: string, expiresIn: number): void {
  removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_REQUEST)
  gateCode.value = code
  gateExpiresIn.value = expiresIn
  removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_CODE)
  shell.Overlay.add({ id: MODAL_PHONE_PAIR_CODE, kind: 'modal', component: PairCodeModal })
}

/** 挂载通知订阅（返回退订函数）：业务字段在网关信封 data 里（蓝本 env?.data ?? {} 兜底） */
function subscribeNotifications(shell: Shell, daemon: DaemonConnection): () => void {
  const offRequest = daemon.onNotification('channel.pair_request', (env) => {
    const data = (env as { data?: ChannelPairRequest } | null)?.data
    if (data?.request_id) pairRequest.value = data
  })
  const offApproved = daemon.onNotification('channel.pair_approved', (env) => {
    const data = (env as { data?: { code?: string; expires_in?: number } } | null)?.data ?? {}
    const status = channelStatus.value
    const code = data.code || status?.gate_code || ''
    if (!code) return
    presentCodeModal(shell, code, data.expires_in || status?.gate_code_expires_in || 300)
  })
  const offCompleted = daemon.onNotification('channel.pair_completed', (env) => {
    const data = (env as { data?: { device_hint?: string } } | null)?.data ?? {}
    removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_CODE)
    pushNotice(shell, 'success', `手机「${data.device_hint || '未知设备'}」已完成配对`)
  })
  return () => {
    offRequest()
    offApproved()
    offCompleted()
  }
}

/** 启动引擎（幂等）：轮询 + 通知订阅 + 请求弹窗编排；返回清理函数（插件卸载用） */
export function startPhonePairEngine(shell: Shell): () => void {
  if (started) return () => {}
  started = true
  shellRef = shell

  const daemon = shell.services.use<DaemonConnection>(DAEMON_CONNECTION)
  offNotify = subscribeNotifications(shell, daemon)

  // 应用生命周期常驻：单例轮询不随组件卸载停止（蓝本同款，清理归插件卸载）
  void refresh()
  pollTimer = setInterval(() => {
    void refresh()
  }, POLL_INTERVAL)

  // 请求弹窗编排（蓝本 watch pairRequest 同款防重：同一请求只弹一次）
  stopWatch = watch(pairRequest, (req) => {
    if (!req || approvingId === req.request_id) return
    approvingId = req.request_id
    presentRequestModal(shell)
  })

  return () => {
    started = false
    shellRef = null
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    stopWatch?.()
    stopWatch = null
    offNotify?.()
    offNotify = null
    removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_REQUEST)
    removeOverlayIfPresent(shell, MODAL_PHONE_PAIR_CODE)
    pairRequest.value = null
    channelStatus.value = null
    gateCode.value = ''
    gateExpiresIn.value = 0
  }
}
