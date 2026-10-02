/**
 * daemon 连接运行时（服务本体）：mindx-work → mindx-daemon 的唯一连接源。
 * 形态对齐 shell.theme / shell.market-runtime 先例——机制性控制器以服务提供，
 * 消费方（models 插件与后续功能）经 useService('daemon.connection') 拿同一份响应式状态。
 * 双模式：本地（端点固定 LOCAL_DAEMON_URL）/ 远程（地址自配置，见 RemoteAddressRow）。
 * 模式与远程地址持久化在 preferences.json（宿主桥落盘，2026-10-02 自 localStorage 迁移）——
 * 它们是"连接到谁"的前置条件，不能存在被连接方（daemon 不可达时无法读取）；
 * 迁移动机：主窗与首启向导窗两个渲染层要共享同一份连接配置（跨窗唯一事实源）。
 * 无宿主桥（纯 Web）降级回 localStorage。向导窗关闭（wizard.finished）后重读配置，
 * 配置有变化即按新端点重连（首启向导完成后的主窗自动接上）。
 */

import { ref } from 'vue'
import { DaemonSocket, LOCAL_DAEMON_URL, type ConnectionState } from './daemon'

export type { ConnectionState }

/** 连接模式：local = 本机 daemon；remote = 远程智能体主机 */
export type DaemonMode = 'local' | 'remote'

/** 服务注册名（消费方以纯字符串引用，插件间禁止 import） */
export const DAEMON_CONNECTION_SERVICE = 'daemon.connection'

const MODE_KEY = 'mindx.daemon.mode'
const REMOTE_URL_KEY = 'mindx.daemon.remoteUrl'

function readLocalMode(): DaemonMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'remote' ? 'remote' : 'local'
  } catch {
    return 'local'
  }
}

function readLocalRemoteUrl(): string {
  try {
    return localStorage.getItem(REMOTE_URL_KEY) || ''
  } catch {
    return ''
  }
}

function persistLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用（隐私模式等）：本次会话内仍生效，刷新后回落缺省
  }
}

export interface DaemonConnection {
  /** 连接状态（响应式） */
  readonly state: ConnectionState
  /** 最近一次错误文案（无错误为 null） */
  readonly lastError: string | null
  /** 连接模式（响应式） */
  readonly mode: DaemonMode
  /** 远程机器地址（响应式；空 = 尚未配置） */
  readonly remoteUrl: string
  /** 切换连接模式：按模式选端点立即重连并持久化；远程未配地址时回落本地端点保持可用 */
  switchMode(mode: DaemonMode): void
  /** 保存远程机器地址并持久化；当前处于远程模式时立即按新地址重连 */
  setRemoteUrl(url: string): void
  /** JSON-RPC 调用 */
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  /** JSON-RPC 通知发送（无 id 无响应；user.message 发消息等通知型通道用）。未连接返回 false */
  notify(method: string, params?: unknown): boolean
  /** 订阅 daemon 通知（如 skills_changed 热重载广播）；返回退订函数 */
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

export function createDaemonConnection(): DaemonConnection & { dispose(): void } {
  const mode = ref<DaemonMode>('local')
  const remoteUrl = ref('')
  const socket = new DaemonSocket(LOCAL_DAEMON_URL)

  /** 按 mode/remoteUrl 解析目标端点（远程未配地址时回落本地端点保持可用） */
  function targetUrl(): string {
    return mode.value === 'remote' && remoteUrl.value ? remoteUrl.value : LOCAL_DAEMON_URL
  }

  /** reconnectTo 幂等（同端点在途/已连时不重连）：首连与重连同路 */
  function start(): void {
    socket.reconnectTo(targetUrl())
  }

  const bridge = window.mxDesktop?.preferences
  if (bridge) {
    // 权威配置读回（preferences.json）：读回前不发起连接；向导写入在主窗加载完成前落盘，
    // 读回天然拿到向导结果。wizard-finished（重入向导）后重读，有变化即重连
    void bridge.getAll().then((all) => {
      mode.value = all?.[MODE_KEY] === 'remote' ? 'remote' : 'local'
      remoteUrl.value = typeof all?.[REMOTE_URL_KEY] === 'string' ? (all[REMOTE_URL_KEY] as string) : ''
      start()
    })
    window.mxDesktop?.wizard.onFinished(() => {
      void bridge.getAll().then((all) => {
        const nextMode: DaemonMode = all?.[MODE_KEY] === 'remote' ? 'remote' : 'local'
        const nextUrl = typeof all?.[REMOTE_URL_KEY] === 'string' ? (all[REMOTE_URL_KEY] as string) : ''
        if (nextMode === mode.value && nextUrl === remoteUrl.value) return
        mode.value = nextMode
        remoteUrl.value = nextUrl
        start()
      })
    })
  } else {
    // 纯 Web 无宿主桥：同步读 localStorage 立即连接（旧路径）
    mode.value = readLocalMode()
    remoteUrl.value = readLocalRemoteUrl()
    start()
  }

  return {
    get state() {
      return socket.state.value
    },
    get lastError() {
      return socket.lastError.value
    },
    get mode() {
      return mode.value
    },
    get remoteUrl() {
      return remoteUrl.value
    },
    switchMode(next: DaemonMode): void {
      if (mode.value === next) return
      mode.value = next
      if (bridge) void bridge.set(MODE_KEY, next)
      else persistLocal(MODE_KEY, next)
      socket.reconnectTo(targetUrl())
    },
    setRemoteUrl(url: string): void {
      remoteUrl.value = url
      if (bridge) void bridge.set(REMOTE_URL_KEY, url)
      else persistLocal(REMOTE_URL_KEY, url)
      if (mode.value === 'remote') {
        socket.reconnectTo(targetUrl())
      }
    },
    call: <T,>(method: string, params?: unknown, timeoutMs?: number) =>
      socket.call<T>(method, params, timeoutMs),
    notify: (method: string, params?: unknown) => socket.notify(method, params),
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
