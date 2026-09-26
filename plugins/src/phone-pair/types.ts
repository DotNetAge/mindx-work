/**
 * 手机连接通道数据契约（照抄 mindx-desktop composables/useChannelStatus.ts 接口定义，
 * RPC 形状已实测：channel.status → {configured, connected, paired, state, url, ...}）。
 * daemon 通知经网关信封约定（type/title/data/meta），业务字段在 data 里。
 */

/** 通道状态摘要（channel.status RPC 返回体） */
export interface ChannelStatus {
  configured: boolean
  url?: string
  connected: boolean
  state?: string
  error?: string
  code?: string
  code_expires_in?: number
  paired?: boolean
  group_id?: string
  gate_code?: string
  gate_code_expires_in?: number
  paired_devices?: string[]
  pending_request?: { request_id: string; device_hint?: string; created_at?: string } | null
}

/** 同意闸配对请求（daemon 经网关广播的业务字段） */
export interface ChannelPairRequest {
  request_id: string
  device_hint?: string
  created_at?: string
}
