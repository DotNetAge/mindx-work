/**
 * 手机连接（AgentHub 通道）领域逻辑：状态轮询、配置读写、地址规范与连通性检查。
 * 移植自 mindx-desktop PhoneLinkPane.vue + useChannelStatus.ts（仅保留本插件消费的机制）。
 * 编辑态（界面选择的连接方式之外的已保存模式/自建地址）提升为模块级单例：
 * 行组件与自建地址 modal 共享同一份（蓝本二者本为同组件，拆分后经此回流）。
 */

import { ref } from 'vue'

/**
 * 官方 AgentHub 服务地址。
 * 占位为本地调试地址——本地尚未调试通，发版时改为 mindx.chat 线上地址。
 */
export const DEFAULT_CHANNEL_URL = 'ws://127.0.0.1:8080/ws'

/** 已保存配置对应的连接方式（'' 为从未配置过） */
export type SavedMode = 'default' | 'custom' | ''

/** channel.status 结果（实证：未配置时返回 configured:false/state:'offline'/url:''） */
export interface ChannelStatus {
  configured?: boolean
  connected?: boolean
  paired?: boolean
  state?: string
  url?: string
  code?: string
  code_expires_in?: number
  error?: string
}

/** user.config 结果（仅声明本插件消费的字段） */
export interface UserConfig {
  channel_url?: string
}

type RpcCaller = <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>

/** 已保存配置对应的模式与自建地址（模块级单例：行组件与 modal 共享） */
export const savedMode = ref<SavedMode>('')
export const customUrl = ref('')

/** 拉取通道状态 */
export function fetchChannelStatus(call: RpcCaller): Promise<ChannelStatus> {
  return call<ChannelStatus>('channel.status', {}, 10000)
}

/** 读用户配置（channel_url 为手机通道当前生效地址） */
export function readUserConfig(call: RpcCaller): Promise<UserConfig> {
  return call<UserConfig>('user.config', {}, 10000)
}

/** 地址规范化：去空白与尾斜杠；缺少协议前缀时补 ws://（蓝本同款） */
export function normalizeWsUrl(raw: string): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^wss?:\/\//i.test(url)) url = 'ws://' + url
  return url
}

/** 连通性检查：ws 地址转 http 后请求 GET /healthz，5 秒超时（蓝本同款） */
export async function checkChannelHealth(wsUrl: string): Promise<boolean> {
  const httpBase = wsUrl.replace(/^ws(s?):\/\//i, (_m, s) => (s ? 'https://' : 'http://'))
  const healthUrl = new URL(httpBase)
  healthUrl.pathname = '/healthz'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const resp = await fetch(healthUrl.toString(), { signal: controller.signal })
    return resp.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 最近一次本地写盘时刻（毫秒）：回流校准的宽限窗基准，防 daemon 写盘延迟被误判为「外部改动」 */
let lastPersistAt = 0

/**
 * daemon 为事实源的开关校准：开关状态不存在 mindx-work，存在 daemon 的 user.config。
 * 每轮通道状态回流时对齐——服务端已配置而本地未映像（外部/跨会话启用）按服务端地址推断模式；
 * 服务端未配置而本地有映像（外部停用）清空本地映像。本地刚写盘的宽限窗内跳过（等 daemon 生效）。
 */
export function reconcileChannelEnabled(st: ChannelStatus): void {
  if (Date.now() - lastPersistAt < 4000) return
  if (st.configured && savedMode.value === '') {
    const url = st.url || ''
    if (url === DEFAULT_CHANNEL_URL) {
      savedMode.value = 'default'
    } else if (url) {
      savedMode.value = 'custom'
      customUrl.value = url
    }
  } else if (!st.configured && savedMode.value !== '') {
    savedMode.value = ''
  }
}

/** 保存手机通道地址（user.config 增量更新），成功后更新已保存模式；仅做 RPC 与状态回流，通知由调用方推送 */
export async function persistChannelUrl(call: RpcCaller, url: string): Promise<boolean> {
  await call('user.config', { channel_url: url }, 10000)
  lastPersistAt = Date.now()
  savedMode.value = url && url !== DEFAULT_CHANNEL_URL ? 'custom' : url ? 'default' : ''
  if (savedMode.value === 'custom') customUrl.value = url
  return true
}

/** 通道状态中文文案（蓝本 PhoneLinkPane 同款映射） */
export function channelStateText(st: ChannelStatus | null): string {
  if (!st?.configured) return '未启用'
  switch (st.state) {
    case 'connecting':
      return '连接中…'
    case 'waiting':
      return st.connected ? '等待手机连接' : '离线，自动重试中'
    case 'paired':
      return '已与手机连接'
    case 'error':
      return '服务暂不可用'
    default:
      return '离线'
  }
}

/** 通道状态色档（驱动状态点：success/warn/fail/次级墨） */
export function channelStateKind(st: ChannelStatus | null): 'success' | 'warn' | 'fail' | 'idle' {
  if (!st?.configured) return 'idle'
  switch (st.state) {
    case 'paired':
      return 'success'
    case 'waiting':
      return st.connected ? 'success' : 'warn'
    case 'error':
      return 'fail'
    default:
      return 'warn'
  }
}
