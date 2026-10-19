/**
 * agents 插件数据契约（移植自 mindx-desktop types/websocket.ts 与 agentTools.ts；
 * 与 daemon agent.* / skill.list RPC 返回结构逐字段对齐，
 * 形状经 daemon 实测双证：agent.list/agent.get/hire/fire/update 均为顶层字段）。
 */

/** agent.list 条目（daemon 顶层字段，desktop 读 meta.hired 的逻辑不适用） */
export interface AgentMeta {
  name: string
  role?: string
  /** 昵称（2-3 字外号，展示主名；统一显示规则 = 昵称 + Role 小字） */
  nick_name?: string
  description?: string
  /** IDENTITY.md 正文（agent.list 不返回，agent.get 才有） */
  introduction?: string
  icon?: string
  /** 业务分类（中文原文） */
  category?: string
  /** 是否已被招募（false 为缺省值） */
  hired?: boolean
  /** 已分配技能名清单 */
  skills?: string[]
  /** 禁用工具名清单（全量 - exclude_tools = 启用） */
  exclude_tools?: string[]
  /** 允许的 MCP 云技能条目（"mcp:<server>"） */
  allows_tools?: string[]
  /** @deprecated 组队已迁移到一等 Team 实体（team.* RPC），后端不再写入此字段 */
  team?: string
  /** @deprecated 组队已迁移到一等 Team 实体（team.* RPC），后端不再写入此字段 */
  members?: string[]
  /** 是否团队负责人（agent.list/get 派生返回，不落盘） */
  is_leader?: boolean
  /** @deprecated 团队职责已迁移到 Team.profile（team.* RPC），后端不再写入此字段 */
  team_duty?: string
  /** 杂项元数据（ratings/version 等） */
  meta?: Record<string, unknown>
}

/** agent.get 结果：Meta 内联 + soul 为 SOUL.md 正文 */
export interface AgentDetailResp {
  introduction?: string
  soul?: string
  allows_tools?: string[]
  /** @deprecated 团队职责已迁移到 Team.profile（team.* RPC），后端不再写入此字段 */
  team_duty?: string
}

/** agent.update 参数（指针语义字段未传与清空由调用方区分） */
export interface AgentUpdateParams {
  name: string
  role?: string
  /** 昵称（frontmatter 顶级键；空串清空，展示回退 role/name） */
  nick_name?: string
  /** 所属团队名（组队写入） */
  team?: string
  /** 团队成员名单（非空即自任负责人；全量覆盖） */
  members?: string[]
  description?: string
  skills?: string[]
  exclude_tools?: string[]
  allows_tools?: string[]
  introduction?: string
  identity_body?: string
  soul?: string
  /** TEAM.md 正文（负责人团队职责；空串清空） */
  team_duty?: string
  meta?: unknown
}

/** agent.hire / agent.fire 结果 */
export interface HireResult {
  status: string
  agent_name: string
  hired: boolean
  message?: string
}

/**
 * 一等 Team 实体（team.list 条目 / team.get 返回，字段与冻结协议逐一对齐）：
 * leader/members 均为 Agent 名引用；hired 标记是否已雇佣（团队会话与团队招聘区口径）。
 */
export interface TeamMeta {
  /** 团队名（唯一标识，team.update 以此定位，不可改） */
  name: string
  /** 昵称（展示主名；统一显示规则 = 昵称 + 名小字） */
  nick_name?: string
  description?: string
  /** 负责人 Agent 名（必填；团队会话 agent 必须为 leader） */
  leader: string
  /** 成员 Agent 名引用数组（全量覆盖） */
  members?: string[]
  icon?: string
  /** 业务分类（中文原文） */
  category?: string
  /** 是否已雇佣（false 为缺省值） */
  hired?: boolean
  /** 团队职责正文（原 TEAM.md；team.get 才有完整值） */
  profile?: string
}

/** team.get 返回（与 team.list 条目同形，独立命名表达语义） */
export type TeamDetail = TeamMeta

/** team.update 参数（指针语义：不传保持不变，传了覆盖含清空；创建与编辑共用） */
export interface TeamUpdateParams {
  name: string
  nick_name?: string
  description?: string
  /** 负责人 Agent 名（必填） */
  leader?: string
  /** 成员 Agent 名引用数组（全量覆盖） */
  members?: string[]
  icon?: string
  category?: string
  profile?: string
  /** 雇佣状态（UI 走 team.hire / team.fire，不直改） */
  hired?: boolean
}

/** skill.list 条目（技能装备中文名/描述回退链用；仅保留本插件消费的字段） */
export interface SkillInfo {
  name: string
  description?: string
  metadata?: Record<string, string>
  license?: string
}

/** 工具定义（name/desc 为 Go 侧工具源码原文；展示名与描述走内置中文文案） */
export interface ToolDef {
  name: string
  desc: string
}

/** 工具组定义（用户看到的抽象能力，组内成员是真实工具名） */
export interface ToolGroupDef {
  key: string
  members: string[]
}

/** 全量内置工具清单（移植自 mindx-desktop agentTools.ts，保存时全量 - 启用 = exclude_tools） */
export const AGENT_TOOLS: ToolDef[] = [
  { name: 'Grep', desc: 'A powerful search tool built on ripgrep' },
  { name: 'Glob', desc: 'Find files by glob patterns' },
  { name: 'Read', desc: 'Reads a file from the local filesystem' },
  { name: 'Write', desc: 'Write content to a file. Creates parent directories automatically' },
  { name: 'Edit', desc: 'Edit files by replacing exact strings' },
  { name: 'Bash', desc: 'Execute a POSIX shell command in the workspace environment' },
  { name: 'WebSearch', desc: 'Search the web for real-time information' },
  { name: 'WebFetch', desc: 'Fetch and extract content from a web page' },
  { name: 'Ls', desc: 'List directory contents with file metadata' },
  { name: 'CollectResults', desc: 'Wait for async tasks to complete and return results' },
  { name: 'TaskCreate', desc: 'Create a task in the task list for tracking work' },
  { name: 'TaskList', desc: 'List all tasks with their status and dependency information' },
  { name: 'TaskGet', desc: 'Get detailed information about a specific task' },
  { name: 'TaskUpdate', desc: 'Advance a task through its lifecycle or update its metadata' },
  { name: 'SubAgent', desc: 'Spawn a sub-agent for a task and collect results later' },
  { name: 'Cron', desc: 'Schedule tasks to run at specified times using cron expressions' },
  { name: 'SendMessage', desc: 'Send notifications or messages to users' },
]

/** 工具组（任务分解 / 工作分发） */
export const AGENT_TOOL_GROUPS: ToolGroupDef[] = [
  { key: 'task', members: ['TaskCreate', 'TaskList', 'TaskGet', 'TaskUpdate'] },
  { key: 'subagent', members: ['SubAgent', 'CollectResults'] },
]

/** 被分组的工具名集合 */
export const GROUPED_TOOL_NAMES = new Set(
  AGENT_TOOL_GROUPS.reduce((acc: string[], g) => acc.concat(g.members), []),
)

/** 独立工具列表（不在任何组中的） */
export const STANDALONE_AGENT_TOOLS = AGENT_TOOLS.filter((t) => !GROUPED_TOOL_NAMES.has(t.name))

/** 工具展示名（内置中文文案，源自 mindx-desktop i18n agentEditor.tools.*） */
export const TOOL_LABELS: Record<string, string> = {
  Grep: '全文搜索',
  Glob: '文件搜索',
  Read: '文件读取',
  Write: '文件写入',
  Edit: '文件编辑',
  Bash: 'Shell 命令',
  RunScript: '脚本执行',
  WebSearch: '网页搜索',
  WebFetch: '网页抓取',
  AskUser: '询问用户',
  Ls: '目录列表',
  CollectResults: '收集结果',
  TaskCreate: '创建任务',
  TaskList: '任务列表',
  TaskGet: '获取任务',
  TaskUpdate: '更新任务',
  SubAgent: '工作分发',
  AgentTalk: 'Agent 对话',
  Cron: '计划任务',
  SendMessage: '发送通知',
}

/** 工具描述（内置中文文案，源自 mindx-desktop i18n agentEditor.toolDescs.*） */
export const TOOL_DESCS: Record<string, string> = {
  Grep: '具有强大而且高速的全文搜索能力',
  Glob: '文件搜索能力',
  Read: '从本地文件系统读取文件内容',
  Write: '写入内容到文件，自动创建父目录',
  Edit: '通过替换精确字符串来编辑文件',
  Bash: '在工作区环境中执行 POSIX Shell 命令',
  WebSearch: '搜索互联网获取实时信息',
  WebFetch: '从网页获取并提取内容',
  Ls: '列出目录内容及文件元数据',
  CollectResults: '等待异步任务完成并返回结果',
  TaskCreate: '在任务列表中创建任务以跟踪工作',
  TaskList: '列出所有任务及其状态和依赖信息',
  TaskGet: '获取特定任务的详细信息',
  TaskUpdate: '推进任务生命周期或更新其元数据',
  SubAgent: '将工作分发给其他员工或者创建一个分身共同完成，复杂的工作会完成得更好',
  Cron: '按指定的 cron 表达式定时执行任务',
  SendMessage: '向用户发送通知或消息',
}

/** 工具组展示名与描述（内置中文文案，源自 mindx-desktop i18n） */
export const GROUP_LABELS: Record<string, string> = {
  task: '任务分解',
  subagent: '工作分发',
}

export const GROUP_DESCS: Record<string, string> = {
  task: '任务分解',
  subagent: '将子任务分发给其他数字员工处理',
}

// ── 组织信箱（M9：跨机器派工与汇报的载体） ─────────────────────

/** 来信条目（mail.inbox 返回的 daemon 留档视图，字段对齐 snake_case） */
export interface OrgMailRow {
  uid: string
  org_slug: string
  from_persona: number
  from_name: string
  subject: string
  body: string
  in_reply_to: string
  received_at: string
}

/** 去信条目（mail.list 返回的服务端对账视图） */
export interface SentMailRow {
  uid: string
  to_persona: number
  subject: string
  in_reply_to: string
  /** sent 已寄出（对方未取）/ delivered 对方已取 */
  status: string
  created_at: string
  reply_count: number
}

/** 组织成员名片（mail.members：写信收件人下拉的数据源） */
export interface MailMemberCard {
  persona_id: number
  display_name: string
  job_title: string
  org_role: string
}
