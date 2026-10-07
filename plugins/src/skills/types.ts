/**
 * skills 插件数据契约（移植自 mindx-desktop types/websocket.ts，仅保留本插件消费的类型；
 * 与 daemon skill.* / fs.* RPC 返回结构逐字段对齐，来源见各接口注释）。
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

/** 分发包安装结果（skill.import） */
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
