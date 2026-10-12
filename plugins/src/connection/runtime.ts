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

import { ref, watch } from 'vue'
import { DaemonSocket, LOCAL_DAEMON_URL, type ConnectionState } from './daemon'

export type { ConnectionState }

/** 连接模式：local = 本机 daemon；remote = 远程智能体主机 */
export type DaemonMode = 'local' | 'remote'

/** 设备接入握手状态（daemon 侧强制闸：未验证连接仅能完成握手） */
export type PairState =
  | 'unverified' // 未验证（连接建立前 / 握手未完成）
  | 'paired' // 已完成接入验证（本机令牌直通或已授权设备）
  | 'pending' // 等待对方批准（本机作为设备接入远端时的等待态）
  | 'denied' // 已被对方拒绝
  | 'closed' // 对方未开启设备接入
  | 'failed' // 无法完成握手（无宿主桥读取令牌 / daemon 未更新）

/** 服务注册名（消费方以纯字符串引用，插件间禁止 import） */
export const DAEMON_CONNECTION_SERVICE = 'daemon.connection'

const MODE_KEY = 'mindx.daemon.mode'
const REMOTE_URL_KEY = 'mindx.daemon.remoteUrl'
const DEVICE_ID_KEY = 'mindx.device.id'

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
  /** 设备接入握手状态（响应式；连接建立后自动完成本机握手） */
  readonly pairState: PairState
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
  const pairState = ref<PairState>('unverified')
  const socket = new DaemonSocket(LOCAL_DAEMON_URL)

  // ── 本机设备身份与接入握手 ────────────────────────────────
  // daemon 侧 RPC 强制闸要求：连接建立后必须完成 device.handshake
  // （本机令牌直通，无弹窗）。设备标识持久化在 preferences（缺失生成 UUID），
  // 令牌与主机名经宿主桥读取（~/.mindx/daemon_token 与 os.hostname）。
  let deviceToken = ''
  let deviceName = ''
  let deviceId = ''

  function ensureDeviceId(): string {
    if (deviceId) return deviceId
    try {
      const stored = localStorage.getItem(DEVICE_ID_KEY)
      if (stored) {
        deviceId = stored
        return deviceId
      }
    } catch {
      // 存储不可用：本次会话内生成临时标识（重连不换，刷新后会再生成）
    }
    deviceId = crypto.randomUUID()
    try {
      localStorage.setItem(DEVICE_ID_KEY, deviceId)
    } catch {
      // 持久化失败不影响本次会话握手
    }
    return deviceId
  }

  /** 连接建立后的本机握手（pending/denied/closed 由对方设备场景产生，状态如实呈现） */
  async function handshake(): Promise<void> {
    pairState.value = 'unverified'
    if (!deviceToken) {
      // 无宿主桥（纯 Web）或令牌缺失：无法完成握手。daemon 未装配闸的旧版本
      // 仍可用（握手失败不阻塞连接，调用失败时按具体错误提示）
      pairState.value = 'failed'
      return
    }
    try {
      const result = await socket.call<{ status: PairState }>(
        'device.handshake',
        { device_id: ensureDeviceId(), name: deviceName, platform: 'macos', token: deviceToken },
        10000,
      )
      pairState.value = result?.status === 'paired' ? 'paired' : (result?.status ?? 'failed')
    } catch (err) {
      // 旧版 daemon（未装配设备闸）没有握手方法：视为已验证，功能全量可用；
      // 其余失败（无令牌/被拒）如实标记，由界面提示
      const msg = err instanceof Error ? err.message : String(err)
      pairState.value = msg.includes('Method not found') ? 'paired' : 'failed'
    }
  }

  watch(socket.state, (st) => {
    if (st === 'connected') void handshake()
  })

  /** 本机身份就绪即记录；连接已建立时补一次握手（防桥读取晚于首连的竞态） */
  void window.mxDesktop?.host?.info?.().then((info) => {
    deviceToken = info?.token ?? ''
    deviceName = info?.hostname || '这台 Mac'
    if (socket.state.value === 'connected') void handshake()
  })

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
    get pairState() {
      return pairState.value
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

/** 设备接入握手状态映射为提示文案（设备分组与状态提示共用） */
export function pairStateText(state: PairState): string {
  switch (state) {
    case 'paired':
      return '已验证'
    case 'pending':
      return '等待对方批准'
    case 'denied':
      return '对方已拒绝'
    case 'closed':
      return '对方未开启设备接入'
    case 'failed':
      return '无法完成验证'
    default:
      return '验证中'
  }
}
