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
  /** 包文件相对清单地址的路径 */
  file: string
  /** 包文件内容十六进制摘要 */
  sha256: string
  /** 包文件字节数（列表展示用） */
  size?: number
}

/** market.list 结果：source 为 remote（在线）/ cache（降级本地缓存） */
export interface MarketListResult {
  packages: MarketPackageInfo[]
  source: 'remote' | 'cache'
  /** 降级原因（source=cache 时非空） */
  warning?: string
  updated_at?: string
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
}

/** 市场固定业务分类（中文）——标签栏按数组顺序陈列，清单中出现未收录分类时
 * 排在固定分类之后按字典序陈列。分类值源自分发包清单的 category 字段（中文原文）。
 * （移植自 mindx-desktop components/settings/marketDomains.ts） */
export const FIXED_DOMAINS = ['办公提效', '产品研发', '内容创作', '数据分析', '市场营销', '商业研究', '经营管理']
