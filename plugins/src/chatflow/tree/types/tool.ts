// 族 4：工具节点（18 种，覆盖 27 个工具）。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §2.2 族 4 与工具对照表。
// 一个工具一种节点类型，不做泛用节点（取舍 8）——payload 字段全部有供给：
// 输入侧来自 tool_exec_start 的结构化 params，结果侧来自 daemon result_meta 旁路
// （取舍 13，前端零解析）。新增工具先补设计文档工具对照表再在此加类型。

import type { NodeBase } from './base'

/**
 * 工具节点公共基底：在壳之上补充全部工具共享的供给字段。
 * - toolName：原始工具名（Read/ReadPro/Bash…），名片文案与图标映射的唯一依据（工具对照表）；
 * - resultMeta：daemon result_meta 旁路结构化统计原样透传（各类型节点按需提取进专有字段，
 *   原始 map 保留供展开态兜底）；构建器产出后下游不得回读原始事件；
 * - outputTail：结果文本尾段（builder 截取），展开态列表/输出的兜底显示供给——
 *   结构化供给 ≠ 全量显示（取舍 18），视图只消费精选字段，禁止 dump 成 JSON 面板。
 */
export interface ToolNodeBase extends NodeBase {
  toolName: string
  resultMeta?: Record<string, unknown>
  outputTail?: string
}

/** 读取文件（Read / ReadPro 归一，归一规则 1） */
export interface ReadToolNode extends ToolNodeBase {
  type: 'tool.read'
  path: string
  offset?: number
  limit?: number
  /** 本次读取行数（result_meta.lines_read） */
  lines?: number
  /** 文件总行数（result_meta.total_lines） */
  totalLines?: number
  format?: 'text' | 'image' | 'doc'
}

/** 写入文件（Write）：diff 展开态复用 FileReviewBar */
export interface WriteToolNode extends ToolNodeBase {
  type: 'tool.write'
  filePath: string
  writeType?: 'create' | 'overwrite' | 'append'
  bytesWritten?: number
  additions?: number
  deletions?: number
  /** 结果中的 unified diff 全文：历史轮无 result_meta 统计时现算 ± 行数的兜底数据源 */
  diff?: string
}

/** 编辑文件（Edit）：diff 展开态复用 FileReviewBar */
export interface EditToolNode extends ToolNodeBase {
  type: 'tool.edit'
  filePath: string
  replaceCount?: number
  replaceMode?: string
  additions?: number
  deletions?: number
  /** 结果中的 unified diff 全文：历史轮无 result_meta 统计时现算 ± 行数的兜底数据源 */
  diff?: string
}

/** 列出目录（Ls / LsPro 归一，归一规则 1） */
export interface LsToolNode extends ToolNodeBase {
  type: 'tool.ls'
  path: string
  recursive?: boolean
  entryCount?: number
}

/** 文件模式匹配（Glob） */
export interface GlobToolNode extends ToolNodeBase {
  type: 'tool.glob'
  pattern: string
  path?: string
  /** 命中数量（result_meta.match_count） */
  matchCount?: number
}

/** 内容搜索（Grep） */
export interface GrepToolNode extends ToolNodeBase {
  type: 'tool.grep'
  pattern: string
  /** 文件过滤 glob（include 参数） */
  include?: string
  mode?: string
  hitCount?: number
}

/** 命令执行（Bash）：展开态复用 BashTerminalView */
export interface BashToolNode extends ToolNodeBase {
  type: 'tool.bash'
  command: string
  workingDir?: string
  exitCode?: number
}

/** 技能脚本执行（RunScript）：展开态复用 BashTerminalView */
export interface RunScriptToolNode extends ToolNodeBase {
  type: 'tool.run_script'
  skillName: string
  script?: string
  args?: string
  exitCode?: number
}

/** 网页抓取（WebFetch） */
export interface WebFetchToolNode extends ToolNodeBase {
  type: 'tool.web_fetch'
  url: string
  title?: string
  bytes?: number
}

/** 联网搜索（WebSearch）：多引擎归一，engines 记录实际引擎回退链路（归一规则 2） */
export interface WebSearchToolNode extends ToolNodeBase {
  type: 'tool.web_search'
  query: string
  engines?: string[]
  failedEngines?: string[]
  cached?: boolean
  resultCount?: number
}

/** 知识库检索（QuickSearch） */
export interface KbSearchToolNode extends ToolNodeBase {
  type: 'tool.kb_search'
  query: string
  targetDir?: string
  hitCount?: number
}

/** 记忆检索（MemorySearch） */
export interface MemorySearchToolNode extends ToolNodeBase {
  type: 'tool.memory_search'
  query: string
  hitCount?: number
}

/** 技能加载（Skill）：关键动作不聚合（groupKey 为 null） */
export interface SkillToolNode extends ToolNodeBase {
  type: 'tool.skill'
  skillName: string
  rootDir?: string
}

/** 等待（Sleep） */
export interface SleepToolNode extends ToolNodeBase {
  type: 'tool.sleep'
  durationMs?: number
}

/** 任务查询（TaskList / TaskGet 归一）：普通查询落工具节点进组降噪（归一规则 3） */
export interface TaskQueryToolNode extends ToolNodeBase {
  type: 'tool.task_query'
  filters?: Record<string, unknown>
  /** 查询结果摘要（名片/展开态一句话） */
  resultDigest?: string
}

/** 团队操作（TeamDelete / TeamList / TeamGetTasks 归一） */
export interface TeamOpsToolNode extends ToolNodeBase {
  type: 'tool.team_ops'
  action: string
  teamName?: string
  resultDigest?: string
}

/** 定时任务管理（Cron） */
export interface CronToolNode extends ToolNodeBase {
  type: 'tool.cron'
  action: string
  /** 定时任务条目 ID（命名避开壳的 id 字段） */
  cronId?: string
  agent?: string
  cronExpr?: string
  enabled?: boolean
}

/** 系统通知（SendMessage） */
export interface NotifyToolNode extends ToolNodeBase {
  type: 'tool.notify'
  title: string
  message?: string
  subtitle?: string
}

/** 工具节点判别联合（18 种） */
export type ToolNode =
  | ReadToolNode
  | WriteToolNode
  | EditToolNode
  | LsToolNode
  | GlobToolNode
  | GrepToolNode
  | BashToolNode
  | RunScriptToolNode
  | WebFetchToolNode
  | WebSearchToolNode
  | KbSearchToolNode
  | MemorySearchToolNode
  | SkillToolNode
  | SleepToolNode
  | TaskQueryToolNode
  | TeamOpsToolNode
  | CronToolNode
  | NotifyToolNode
