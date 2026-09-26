/**
 * agents 插件数据契约（移植自 mindx-desktop types/websocket.ts 与 agentTools.ts；
 * 与 daemon agent.* / market.* / mcp.server.* / skill.list RPC 返回结构逐字段对齐，
 * 形状经 daemon 实测双证：agent.list/agent.get/hire/fire/update 均为顶层字段）。
 */

/** agent.list 条目（daemon 顶层字段，desktop 读 meta.hired 的逻辑不适用） */
export interface AgentMeta {
  name: string
  role?: string
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
  /** 杂项元数据（ratings/version 等） */
  meta?: Record<string, unknown>
}

/** agent.get 结果：Meta 内联 + soul 为 SOUL.md 正文 */
export interface AgentDetailResp {
  introduction?: string
  soul?: string
  allows_tools?: string[]
}

/** agent.update 参数（指针语义字段未传与清空由调用方区分） */
export interface AgentUpdateParams {
  name: string
  role?: string
  description?: string
  skills?: string[]
  exclude_tools?: string[]
  allows_tools?: string[]
  introduction?: string
  identity_body?: string
  soul?: string
  meta?: unknown
}

/** agent.hire / agent.fire 结果 */
export interface HireResult {
  status: string
  agent_name: string
  hired: boolean
  message?: string
}

/** skill.list 条目（技能装备中文名/描述回退链用；仅保留本插件消费的字段） */
export interface SkillInfo {
  name: string
  description?: string
  metadata?: Record<string, string>
  license?: string
}

/** mcp.server.list 条目（仅保留云技能勾选所需字段） */
export interface CloudConnectorEntry {
  name: string
  enabled?: boolean
  title?: string
  description?: string
}

/** 市场分发包条目（market.list 货架项；agent 包含 role/skills/skillNames/skillDescs） */
export interface MarketAgentPackage {
  kind: 'agent' | 'skill'
  name: string
  description?: string
  icon?: string
  /** 角色名（中文原文，市场卡片展示名） */
  role?: string
  /** 业务分类（中文原文） */
  category?: string
  /** 技能名清单 */
  skills?: string[]
  /** 技能中文展示名映射（技能名 → metadata.name_zh） */
  skillNames?: Record<string, string>
  /** 技能描述映射（打包时收集的 frontmatter 原文） */
  skillDescs?: Record<string, string>
  /** 包版本 */
  version?: string
  file: string
  sha256: string
  size?: number
}

/** market.list 结果：source 为 remote（在线）/ cache（降级本地缓存） */
export interface MarketListResult {
  packages: MarketAgentPackage[]
  source: 'remote' | 'cache'
  /** 降级原因（source=cache 时非空） */
  warning?: string
}

/** 分发包安装结果（market.install） */
export interface BundleInstallResult {
  kind: 'agent' | 'skill'
  name: string
  skills_global?: string[]
  skills_agent?: string[]
  overwritten?: boolean
}

/** 市场固定业务分类（中文）——标签栏按数组顺序陈列，清单中出现未收录分类时
 * 排在固定分类之后按字典序陈列。（移植自 mindx-desktop marketDomains.ts） */
export const FIXED_DOMAINS = ['办公提效', '产品研发', '内容创作', '数据分析', '市场营销', '商业研究', '经营管理']

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
  { name: 'TeamCreate', desc: 'Create a team of agents that work together on a task' },
  { name: 'TeamDelete', desc: 'Delete a team and clean up its associated data' },
  { name: 'TeamList', desc: 'List all teams with their members and status' },
  { name: 'TeamGetTasks', desc: 'Get all tasks assigned to a team' },
  { name: 'Cron', desc: 'Schedule tasks to run at specified times using cron expressions' },
  { name: 'SendMessage', desc: 'Send notifications or messages to users' },
]

/** 工具组（任务分解 / 团队合作 / 工作分发） */
export const AGENT_TOOL_GROUPS: ToolGroupDef[] = [
  { key: 'task', members: ['TaskCreate', 'TaskList', 'TaskGet', 'TaskUpdate'] },
  { key: 'team', members: ['TeamCreate', 'TeamDelete', 'TeamList', 'TeamGetTasks'] },
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
  TeamCreate: '创建团队',
  TeamDelete: '删除团队',
  TeamList: '团队列表',
  TeamGetTasks: '团队任务',
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
  TeamCreate: '创建一组 Agent 协作处理任务',
  TeamDelete: '删除团队并清理相关数据',
  TeamList: '列出所有团队及其成员和状态',
  TeamGetTasks: '获取分配给团队的所有任务',
  Cron: '按指定的 cron 表达式定时执行任务',
  SendMessage: '向用户发送通知或消息',
}

/** 工具组展示名与描述（内置中文文案，源自 mindx-desktop i18n） */
export const GROUP_LABELS: Record<string, string> = {
  task: '任务分解',
  team: '团队合作',
  subagent: '工作分发',
}

export const GROUP_DESCS: Record<string, string> = {
  task: '可将复杂任务分解为多个具体工作项逐项完成',
  team: '临时建立专家团协作完成的复杂任务',
  subagent: '将子任务分发给其他数字员工处理',
}
