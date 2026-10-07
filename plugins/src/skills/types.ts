/**
 * skills 插件数据契约（移植自 mindx-desktop types/websocket.ts，仅保留本插件消费的类型；
 * 与 daemon skill.* / market.* / fs.* RPC 返回结构逐字段对齐，来源见各接口注释）。
 */

/** skill.list 条目 */
export interface SkillInfo {
  name: string
  description?: string
  /** 技能目录绝对路径（缺失则无法编辑与读取正文） */
  root_dir?: string
  source?: string
  metadata?: Record<string, string>
  license?: string
  /** 技能库层级：global（全局库）/ agent（Agent 级库） */
  level?: 'global' | 'agent'
}

/** 市场分发包条目（market.list 返回的货架项，sha256 仅用于传输完整性校验） */
export interface MarketPackageInfo {
  kind: 'agent' | 'skill'
  name: string
  description?: string
  icon?: string
  /** 业务分类（中文原文；市场卡片/标签栏过滤用） */
  category?: string
  /** 技能中文展示名映射（技能名 → metadata.name_zh） */
  skillNames?: Record<string, string>
  /** 包版本（源为 SKILL.md frontmatter metadata.version） */
  version?: string
  /** 包文件相对清单地址的路径（服务端分页 API 响应可为空，下载走 download_url 直连） */
  file?: string
  /** 包文件下载直连地址（服务端分页 API 下发；安装直连无需清单拼接） */
  download_url?: string
  /** 包文件内容十六进制摘要 */
  sha256: string
  /** 包文件字节数（列表展示用） */
  size?: number
}

/** market.list 分页/过滤参数（全部可选：空参 = 存量全量清单语义；带参 = 服务端分页 API） */
export interface MarketListParams {
  /** 页码，1 起始 */
  page?: number
  /** 每页条数（缺省 50，服务端上限 200） */
  page_size?: number
  /** 包类型过滤 */
  kind?: 'agent' | 'skill'
  /** 对 name/description 的查找词 */
  q?: string
}

/** market.list 结果：source 为 remote（在线）/ cache（降级本地缓存） */
export interface MarketListResult {
  packages: MarketPackageInfo[]
  source: 'remote' | 'cache'
  /** 降级原因（source=cache 时非空） */
  warning?: string
  updated_at?: string
  /** 服务端命中的总条数（带分页参数时返回；空参全量语义无此字段） */
  total?: number
  /** 当前页码（1 起始，带分页参数时返回） */
  page?: number
}

/** 分发包安装结果（market.install / skill.import 共用） */
export interface BundleInstallResult {
  kind: 'agent' | 'skill'
  name: string
  /** 安装到全局库的技能名列表 */
  skills_global?: string[]
  /** 安装到 Agent 级库的技能名列表 */
  skills_agent?: string[]
  /** 是否覆盖了已存在的目标 */
  overwritten?: boolean
  /** 安装即触发的准备流程状态（仅列非 ok 且有警告的技能；阶段五） */
  prepares?: SkillPrepareResult[]
}

/** 技能准备流程状态（安装响应 prepares[] 与 skill.prepare 共用形状） */
export interface SkillPrepareResult {
  skill: string
  status: 'ok' | 'oauth_started' | 'needs_confirm' | 'blocked'
  /** 环境不满足原因或缺失二进制清单 */
  warnings?: string[]
  /** oauth_started：提供商名与展示名 */
  provider?: string
  provider_title?: string
  /** oauth_started：令牌落库的凭据名 */
  env?: string
  /** needs_confirm：本平台待确认安装命令 */
  commands?: string[]
  platform?: string
  /** blocked：环境不满足原因 */
  message?: string
}

/** 市场固定业务分类（中文）——标签栏按数组顺序陈列，清单中出现未收录分类时
 * 排在固定分类之后按字典序陈列。分类值源自分发包清单的 category 字段（中文原文，
 * daemon 对 slug 形态的历史数据统一归一为中文；与服务端 categories 种子同词汇表）。
 * （移植自 mindx-desktop components/settings/marketDomains.ts） */
export const FIXED_DOMAINS = ['办公提效', '产品研发', '智能硬件', '工业', '内容创作', '数据分析', '市场营销', '财务', '经营管理']
