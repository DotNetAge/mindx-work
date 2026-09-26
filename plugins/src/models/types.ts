/**
 * models 插件数据契约（移植自 mindx-desktop types/websocket.ts，仅保留本插件消费的类型；
 * 与 daemon RPC 返回结构逐字段对齐，来源见各接口注释）。
 */

/** provider.list / provider.create / provider.update 返回 */
export interface ProviderInfo {
  name: string
  title: string
  base_url: string
  /** true = 已配置密钥（daemon 不回传明文） */
  api_key: boolean
  is_local: boolean
}

export interface ProviderCreateParams {
  name: string
  title: string
  base_url: string
  api_key: string
  auth_token?: string
  is_local?: boolean
}

export interface ProviderUpdateParams {
  name: string
  title?: string
  base_url?: string
  api_key?: string
  auth_token?: string
  is_local?: boolean
}

/** model.list 条目 */
export interface ModelConfig {
  name: string
  title?: string
  description: string
  provider: string
  base_url?: string
  context_length?: number
  func_calling?: boolean
  structuring?: boolean
  web_searching?: boolean
  visioning?: boolean
  prefix_con?: boolean
  context_cache?: boolean
  enabled?: boolean
  is_local?: boolean
  temperature?: number
  top_p?: number
  max_turns?: number
  cost_per_1m_in?: number
  cost_per_1m_out?: number
  cost_per_1m_in_cache?: number
}

/** model.create 参数 */
export interface ModelCreateParams {
  name: string
  title: string
  description?: string
  provider: string
  base_url?: string
  api_key?: string
  auth_token?: string
  context_length?: number
  is_local?: boolean
  func_calling?: boolean
  structuring?: boolean
  web_searching?: boolean
  visioning?: boolean
  prefix_con?: boolean
  context_cache?: boolean
  temperature?: number
  enabled?: boolean
  max_turns?: number
  cost_per_1m_in?: number
  cost_per_1m_out?: number
  cost_per_1m_in_cache?: number
}

/** model.update 参数 */
export interface ModelUpdateParams {
  name: string
  title?: string
  description?: string
  provider?: string
  base_url?: string
  api_key?: string
  auth_token?: string
  context_length?: number | null
  is_local?: boolean | null
  func_calling?: boolean | null
  structuring?: boolean | null
  web_searching?: boolean | null
  visioning?: boolean | null
  prefix_con?: boolean | null
  context_cache?: boolean | null
  temperature?: number | null
  enabled?: boolean | null
  max_turns?: number | null
  cost_per_1m_in?: number | null
  cost_per_1m_out?: number | null
  cost_per_1m_in_cache?: number | null
}

/** provider.fetch_ollama_models 条目 */
export interface OllamaModelInfo {
  name: string
  size: number
  digest: string
  created_at: string
}

/** provider.fetch_ollama_model_detail 返回 */
export interface OllamaModelDetail {
  name: string
  context_length: number
  parameter_size: string
  quantization: string
  model_family: string
  parameter_count: number
}

/** 在线模型库规范化条目（daemon rpc.OnlineModelInfo，七家浏览器共用） */
export interface OnlineModelInfo {
  id: string
  title?: string
  description?: string
  context_length?: number
  free?: boolean
  cost_per_1m_in?: number
  cost_per_1m_out?: number
  func_calling?: boolean
  visioning?: boolean
  owned_by?: string
}
