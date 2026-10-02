/**
 * 向导专用 daemon 连接（独立于主窗的 daemon.connection 服务）：
 * 向导窗有自己的生命周期——连接测试（WebSocket 握手）与模型导入（JSON-RPC）都经此客户端；
 * 向导窗关闭即丢弃，不影响主窗连接。
 * 形态对齐 plugins/src/connection/daemon.ts（同一作者约定），但向导只需要
 * connect / call / 退订，独立小实现避免引壳服务上下文。
 */

type State = 'disconnected' | 'connecting' | 'connected' | 'error'

/** JSON-RPC 消息形态 */
interface RpcResponse {
  id?: number
  result?: unknown
  error?: { message: string }
}

export class WizardDaemon {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  constructor(readonly url: string) {}

  /** 建立 WebSocket 连接；成功 resolve，失败/超时 reject（测试连接即此方法） */
  connect(timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('连接超时'))
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('无法建立 WebSocket 连接'))
      }
      ws.onmessage = (event) => {
        let msg: RpcResponse
        try {
          msg = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) rej(new Error(msg.error.message))
          else res(msg.result)
        }
      }
    })
  }

  /** 连接就绪后调 JSON-RPC；未连接抛错 */
  call<T>(method: string, params?: unknown, timeoutMs = 10000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('智能主机未连接'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('调用超时'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }))
    })
  }

  dispose(): void {
    for (const { reject } of this.pending.values()) reject(new Error('向导已关闭'))
    this.pending.clear()
    this.ws?.close()
    this.ws = null
  }
}

/** 状态文案映射（向导连接步骤展示用） */
export function wizardStateText(state: State): string {
  switch (state) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'error':
      return '连接失败'
    default:
      return '未连接'
  }
}
