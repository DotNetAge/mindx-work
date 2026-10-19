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
// 远端 daemon 批准接入后下发的设备令牌（按端点各存一份）：重连握手回传即免配对，
// 不回传则每次重连都会在对方机器重新弹审批（devgate 会话登记不跨连接存活）
const DEVICE_TOKENS_KEY = 'mindx.device.tokens'

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
  /** 最近一次握手拒绝原因（人话，供设备行提示；无则为空） */
  readonly pairMessage: string
  /** 切换连接模式：按模式选端点立即重连并持久化；远程未配地址时回落本地端点保持可用 */
  switchMode(mode: DaemonMode): void
  /** 保存远程机器地址并持久化；pairCode 为一次性配对码（可选，远程首连无凭据时
   *  携带——对应主机上 mindx pair 生成的码）。当前处于远程模式时立即按新地址重连 */
  setRemoteUrl(url: string, pairCode?: string): void
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
  const pairMessage = ref('')
  const socket = new DaemonSocket(LOCAL_DAEMON_URL)
  // 远程连接首条消息认证失败时，主机回告原因并断开——如实呈现给用户
  // （设备未建立信任/配对码已过期等，用户按提示重新配对）
  socket.onUnhandledError = (message) => {
    if (mode.value === 'remote' && remoteUrl.value) {
      pairState.value = 'failed'
      pairMessage.value = message
    }
  }

  // ── 本机设备身份与接入握手 ────────────────────────────────
  // daemon 侧 RPC 强制闸要求：连接建立后必须完成 device.handshake
  // （本机令牌直通，无弹窗）。设备标识持久化在 preferences（缺失生成 UUID），
  // 令牌与主机名经宿主桥读取（~/.mindx/daemon_token 与 os.hostname）。
  let deviceToken = ''
  let deviceName = ''
  let deviceId = ''
  /** 各远端下发的设备令牌表：端点 → 令牌（本机直通路径不会下发，故 local 端点天然无条目） */
  let deviceTokens: Record<string, string> = {}
  /** 一次性配对码（远程首连无凭据时用，对应主机上 mindx pair 生成的码）：
   *  只在内存里活到握手消费成功，刷新/切换即失效（重新生成再填） */
  let pendingPairCode = ''

  /** 读回持久化的设备令牌表（preferences 存 JSON 字符串；纯 Web 直接存字符串） */
  function loadDeviceTokens(raw: unknown): void {
    if (typeof raw !== 'string' || !raw) return
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        deviceTokens = parsed as Record<string, string>
      }
    } catch {
      // 数据损坏：忽略，走既有审批流程重新领取
    }
  }

  function persistDeviceTokens(): void {
    const json = JSON.stringify(deviceTokens)
    if (bridge) void bridge.set(DEVICE_TOKENS_KEY, json)
    else persistLocal(DEVICE_TOKENS_KEY, json)
  }

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

  /** 连接建立后的接入握手（pending/denied/closed 由对方设备场景产生，状态如实呈现）。
   *  凭据优先级：当前端点已领取的设备令牌（重连免配对）→ 本机令牌（本机直通；
   *  跨 Mac 首连必然不匹配，走对方审批）→ 一次性配对码（远程首连，对方视同
   *  批准直接签发设备令牌）。 */
  async function handshake(): Promise<void> {
    pairState.value = 'unverified'
    pairMessage.value = ''
    const base = baseEndpoint()
    const stored = deviceTokens[base] || deviceToken
    if (!stored && !pendingPairCode) {
      // 无宿主桥（纯 Web）且无已领取设备令牌、也无配对码：无法完成握手。
      // daemon 未装配闸的旧版本仍可用（握手失败不阻塞连接，调用失败时按具体错误提示）
      pairState.value = 'failed'
      return
    }
    try {
      const result = await socket.call<{ status: PairState; token?: string; message?: string }>(
        'device.handshake',
        {
          device_id: ensureDeviceId(),
          name: deviceName,
          platform: 'macos',
          token: stored,
          pair_code: pendingPairCode || undefined,
        },
        10000,
      )
      // 首连获批（对方批准或配对码）会下发设备令牌：按端点持久化，
      // 断线重连时首条消息直接携带该令牌（重连免配对）
      if (result?.token) {
        deviceTokens[base] = result.token
        persistDeviceTokens()
        pendingPairCode = ''
      }
      pairMessage.value = result?.message ?? ''
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

  /** 按 mode/remoteUrl 解析基础端点（远程未配地址时回落本地端点保持可用） */
  function baseEndpoint(): string {
    return mode.value === 'remote' && remoteUrl.value ? remoteUrl.value : LOCAL_DAEMON_URL
  }

  /** 连接建立后的首条消息设备认证（仅远程端点）：浏览器 WebSocket 无法
   *  自定义请求头，设备令牌/一次性配对码改由连接后首条消息携带——本机
   *  端点走环回直通，无需认证。凭证缺失也照发（由主机回告具体原因，
   *  认证失败主机会断开连接，原因经 onUnhandledError 呈现）。 */
  function sendFirstMessageAuth(): void {
    if (mode.value !== 'remote' || !remoteUrl.value) return
    const token = deviceTokens[baseEndpoint()] || deviceToken
    if (!socket.notify('device.auth', {
      token: token || undefined,
      pair_code: !token && pendingPairCode ? pendingPairCode : undefined,
    })) {
      // 发送失败（连接刚被断开）：交由重连机制重试
    }
  }

  /** reconnectTo 幂等（同端点在途/已连时不重连）：首连与重连同路 */
  function start(): void {
    socket.onOpen = sendFirstMessageAuth
    socket.reconnectTo(baseEndpoint())
  }

  const bridge = window.mxDesktop?.preferences
  if (bridge) {
    // 权威配置读回（preferences.json）：读回前不发起连接；向导写入在主窗加载完成前落盘，
    // 读回天然拿到向导结果。wizard-finished（重入向导）后重读，有变化即重连
    void bridge.getAll().then((all) => {
      mode.value = all?.[MODE_KEY] === 'remote' ? 'remote' : 'local'
      remoteUrl.value = typeof all?.[REMOTE_URL_KEY] === 'string' ? (all[REMOTE_URL_KEY] as string) : ''
      loadDeviceTokens(all?.[DEVICE_TOKENS_KEY])
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
    try {
      loadDeviceTokens(localStorage.getItem(DEVICE_TOKENS_KEY))
    } catch {
      // 存储不可用：无已领取令牌，握手按无令牌路径处理
    }
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
    get pairMessage() {
      return pairMessage.value
    },
    switchMode(next: DaemonMode): void {
      if (mode.value === next) return
      mode.value = next
      if (bridge) void bridge.set(MODE_KEY, next)
      else persistLocal(MODE_KEY, next)
      socket.reconnectTo(baseEndpoint())
    },
    setRemoteUrl(url: string, pairCode?: string): void {
      remoteUrl.value = url
      pendingPairCode = pairCode || ''
      if (bridge) void bridge.set(REMOTE_URL_KEY, url)
      else persistLocal(REMOTE_URL_KEY, url)
      if (mode.value === 'remote') {
        socket.reconnectTo(baseEndpoint())
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
