/**
 * 设备接入请求引擎（模块级常驻单例）：监听 devgate.pair_request 通知弹出
 * 同意/拒绝弹窗。phone-pair 引擎同款范式（模块级常驻、Overlay 席位、modal 互斥），
 * 差异：无轮询兜底——外部设备重试握手会重新触发请求通知，桌面端弹窗是唯一审批入口。
 * 批准/拒绝动作内聚在弹窗组件（动作即弹窗生命周期，无跨组件共享状态的需求）。
 */

import { ref, watch } from 'vue'
import type { useShell } from '@mindx-work/ui-shell-vue'
import { MODAL_DEVICE_REQUEST } from './ids'
import DeviceRequestModal from './overlays/DeviceRequestModal.vue'

/** useShell 返回的壳上下文类型 */
type Shell = ReturnType<typeof useShell>

/** 服务以纯字符串名消费（插件间禁止 import；契约 §10.2） */
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

/** devgate.pair_request 通知的 data 载荷（devgate.PairRequest 序列化形状） */
export interface DevicePairRequest {
  request_id: string
  device_id: string
  name: string
  platform: string
}

/** 最新待审批的设备接入请求（通知驱动，消费后置空） */
export const pairRequest = ref<DevicePairRequest | null>(null)

let started = false
let offNotify: (() => void) | null = null
let stopWatch: (() => void) | null = null
/** 已弹过确认弹窗的请求 id（防同一请求重复弹窗，phone-pair approvingId 同款） */
let approvingId = ''

/** overlay modal 互斥惯例：同 id 先 has 再 remove */
function removeOverlayIfPresent(shell: Shell, id: string): void {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
}

/** 消费指定请求（批准/拒绝处理后调用，避免重复弹窗；phone-pair clearPairRequest 同构） */
export function clearPairRequest(requestId?: string): void {
  if (!requestId || pairRequest.value?.request_id === requestId) {
    pairRequest.value = null
  }
}

/** 启动引擎（幂等）：通知订阅 + 弹窗编排；返回清理函数（插件卸载用） */
export function startDeviceGateEngine(shell: Shell): () => void {
  if (started) return () => {}
  started = true

  const daemon = shell.services.use<DaemonConnection>(DAEMON_CONNECTION)
  offNotify = daemon.onNotification('devgate.pair_request', (env) => {
    const data = (env as { data?: DevicePairRequest } | null)?.data
    if (data?.request_id) pairRequest.value = data
  })

  // 弹窗编排（phone-pair watch 同款防重：同一请求只弹一次）
  stopWatch = watch(pairRequest, (req) => {
    if (!req || approvingId === req.request_id) return
    approvingId = req.request_id
    removeOverlayIfPresent(shell, MODAL_DEVICE_REQUEST)
    shell.Overlay.add({ id: MODAL_DEVICE_REQUEST, kind: 'modal', component: DeviceRequestModal })
  })

  return () => {
    started = false
    stopWatch?.()
    stopWatch = null
    offNotify?.()
    offNotify = null
    removeOverlayIfPresent(shell, MODAL_DEVICE_REQUEST)
    pairRequest.value = null
  }
}
