/**
 * daemon 连接运行时（服务本体）：mindx-work → mindx-daemon 的唯一连接源。
 * 形态对齐 shell.theme / shell.market-runtime 先例——机制性控制器以服务提供，
 * 消费方（models 插件与后续功能）经 useService('daemon.connection') 拿同一份响应式状态。
 * 本期仅本地模式（规格定稿）：端点固定 LOCAL_DAEMON_URL，装配即自动连接，零配置。
 */

import { DaemonSocket, LOCAL_DAEMON_URL, type ConnectionState } from './daemon'

export type { ConnectionState }

/** 服务注册名（消费方以纯字符串引用，插件间禁止 import） */
export const DAEMON_CONNECTION_SERVICE = 'daemon.connection'

export interface DaemonConnection {
  /** 连接状态（响应式） */
  readonly state: ConnectionState
  /** 最近一次错误文案（无错误为 null） */
  readonly lastError: string | null
  /** 连接模式；本期仅 'local'（远程模式为后续迭代预留语义位，当前无 UI） */
  readonly mode: 'local'
  /** JSON-RPC 调用 */
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  /** 订阅 daemon 通知（如 skills_changed 热重载广播）；返回退订函数 */
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

export function createDaemonConnection(): DaemonConnection & { dispose(): void } {
  const socket = new DaemonSocket(LOCAL_DAEMON_URL)
  socket.connect()

  return {
    get state() {
      return socket.state.value
    },
    get lastError() {
      return socket.lastError.value
    },
    mode: 'local',
    call: <T,>(method: string, params?: unknown, timeoutMs?: number) =>
      socket.call<T>(method, params, timeoutMs),
    onNotification: (method: string, cb: (params: unknown) => void) =>
      socket.onNotification(method, cb),
    dispose: () => socket.dispose(),
  }
}

/** 供内部设置行把状态映射为提示文案 */
export function stateText(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'reconnecting':
      return '重连中'
    case 'error':
      return '连接出错'
    default:
      return '未连接'
  }
}

