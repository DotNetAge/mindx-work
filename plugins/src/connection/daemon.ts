/**
 * daemon WebSocket JSON-RPC 客户端（移植自 mindx-desktop services/websocket.ts，
 * 仅保留当前消费者需要的机制：call / 状态 / 心跳 / 退避重连）。
 * 协议实证：请求 {"jsonrpc":"2.0",id,method,params}；响应按行分发，id+result|error 配对；
 * 心跳为 ping 通知；断线按 1.5 指数退避重连（3s 起、30s 封顶，10 次）。
 */

import { ref } from 'vue'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/** 本地 daemon 连接端点（实证：mindx-desktop connectionStore 缺省 ws://localhost:1314/ws） */
export const LOCAL_DAEMON_URL = 'ws://localhost:1314/ws'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export class DaemonSocket {
  private ws: WebSocket | null = null
  private readonly url: string
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  /** daemon 通知订阅表：method → 订阅回调集合（如 skills_changed 热重载广播） */
  private notificationHandlers = new Map<string, Set<(params: unknown) => void>>()
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private messageId = 0

  /** 连接状态与最近错误（响应式，消费方直接读） */
  readonly state = ref<ConnectionState>('disconnected')
  readonly lastError = ref<string | null>(null)

  constructor(url: string) {
    this.url = url
  }

  /** 建立连接；已在途/已连接时幂等返回 */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.state.value = 'connecting'
    this.lastError.value = null
    try {
      this.ws = new WebSocket(this.url)
    } catch (error) {
      this.lastError.value = String(error)
      this.state.value = 'error'
      this.scheduleReconnect()
      return
    }
    this.ws.onopen = () => {
      this.state.value = 'connected'
      this.reconnectAttempts = 0
      this.startHeartbeat()
    }
    this.ws.onmessage = (event) => this.handleMessage(event.data)
    this.ws.onclose = () => {
      this.stopHeartbeat()
      this.state.value = 'disconnected'
      this.scheduleReconnect()
    }
    this.ws.onerror = () => {
      this.lastError.value = 'WebSocket 连接错误'
      this.state.value = 'error'
    }
  }

  /** JSON-RPC 调用：id 配对 resolve / error.message reject，超时兜底 */
  call<T>(method: string, params?: unknown, timeoutMs = 60000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('尚未连接到 mindx-daemon'))
        return
      }
      const id = `msg_${Date.now()}_${++this.messageId}`
      const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC 调用超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value as T)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.ws.send(JSON.stringify(request))
    })
  }

  /** 订阅 daemon 通知（无 id 消息按 method 分发）；返回退订函数 */
  onNotification(method: string, cb: (params: unknown) => void): () => void {
    let set = this.notificationHandlers.get(method)
    if (!set) {
      set = new Set()
      this.notificationHandlers.set(method, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) this.notificationHandlers.delete(method)
    }
  }

  /** 断开并停止重连（插件清理用） */
  dispose(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // 置满重试计数以阻止 onclose 触发的再重连
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close(1000, '客户端断开')
      this.ws = null
    }
    this.pending.forEach(({ reject }) => reject(new Error('连接已关闭')))
    this.pending.clear()
    this.state.value = 'disconnected'
  }

  private handleMessage(raw: string): void {
    // 响应按行分割（实证：源实现按 '\n' 切分逐行解析）
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const message = JSON.parse(line) as JsonRpcResponse
        if (message.id === undefined) {
          // 无 id = 通知：按方法名分发给订阅者（单个订阅者异常不拖垮其余分发）
          if (message.method) this.dispatchNotification(message.method, message.params)
          continue
        }
        const pending = this.pending.get(String(message.id))
        if (!pending) continue
        this.pending.delete(String(message.id))
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      } catch {
        // 非 JSON 行忽略（同源实现容错）
      }
    }
  }

  private dispatchNotification(method: string, params: unknown): void {
    const set = this.notificationHandlers.get(method)
    if (!set) return
    for (const cb of set) {
      try {
        cb(params)
      } catch {
        // 订阅者异常仅隔离自身，不影响连接与其余订阅者
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('{"jsonrpc":"2.0","method":"ping"}')
      }
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
    this.reconnectAttempts += 1
    this.state.value = 'reconnecting'
    const delay = Math.min(RECONNECT_INTERVAL * 1.5 ** (this.reconnectAttempts - 1), 30000)
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }
}

const HEARTBEAT_INTERVAL = 54000
const RECONNECT_INTERVAL = 3000
const MAX_RECONNECT_ATTEMPTS = 10
