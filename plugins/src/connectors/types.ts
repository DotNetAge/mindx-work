/**
 * connectors 插件数据契约（移植自 mindx-desktop types/mcp.ts，仅保留本插件消费的类型；
 * 与 daemon mcp.server.* RPC 返回结构逐字段对齐，来源见各接口注释）。
 */

/** 连接器传输类型：stdio = 本地进程，sse / http = 远程服务 */
export type MCPServerType = 'stdio' | 'sse' | 'http'

/** mcp.server.add / mcp.server.update 参数（update 时 daemon 保留 enabled 与旧凭据） */
export interface MCPServerConfig {
  name: string
  type: MCPServerType
  // stdio
  command?: string
  args?: string[]
  env?: Record<string, string>
  // sse / http
  url?: string
  headers?: Record<string, string>
  // 凭据（daemon 只存 ref，不回传明文）
  credential?: Record<string, string>
  idle_ttl_secs: number
}

/** mcp.server.list 条目 */
export interface MCPServerListEntry {
  name: string
  /** 展示名（mcp.json 的 title 属性，可空） */
  title?: string
  /** 面向用户的描述（可空） */
  description?: string
  type: string
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  /** 凭据仅返回 ref key 不返回值；存在即表示已配置凭据 */
  credential_ref?: string
  idle_ttl_secs: number
  /** 是否启用（缺省 false——装了不等于启用） */
  enabled: boolean
}

/** mcp.server.test 返回 */
export interface MCPServerTestResult {
  ok: boolean
  error?: string
}
