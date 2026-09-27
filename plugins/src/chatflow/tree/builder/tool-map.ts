// 工具对照表的代码锚点：工具名 → 节点类型 / 聚合类别。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §2.2 工具对照表（取舍 12）——
// 显示名、图标、type 三者的对齐只发生在这张表上；builder 用它做「工具名 → 节点类型」
// 归一，视图层的显示名/图标契约由 registry 落地。新增工具先补设计文档表格再在此登记。
//
// 特别说明（归一规则 3/4）：TaskCreate / TaskUpdate 不落工具节点（task 实体 upsert）、
// SubAgent 落 subagent、AskUser 落 ask_user、CollectResults 落 collect——
// 这四类不出现在本表，由 builder 主流程特判。

import type { GroupKey } from '../types/base'
import type { ToolNode } from '../types/tool'

/** 工具登记项：节点类型 + 聚合类别（groupKey 为 null 表示关键动作不聚合，如 Skill） */
export interface ToolDescriptor {
  nodeType: ToolNode['type']
  groupKey: GroupKey | null
}

/** 工具名 → 登记项（覆盖全部 27 个工具，ReadPro/LsPro 等增强版归一到同一节点类型） */
export const TOOL_DESCRIPTOR_MAP: Record<string, ToolDescriptor> = {
  Read: { nodeType: 'tool.read', groupKey: 'fs.read' },
  ReadPro: { nodeType: 'tool.read', groupKey: 'fs.read' },
  Write: { nodeType: 'tool.write', groupKey: 'fs.write' },
  Edit: { nodeType: 'tool.edit', groupKey: 'fs.write' },
  Ls: { nodeType: 'tool.ls', groupKey: 'fs.browse' },
  LsPro: { nodeType: 'tool.ls', groupKey: 'fs.browse' },
  Glob: { nodeType: 'tool.glob', groupKey: 'fs.browse' },
  Grep: { nodeType: 'tool.grep', groupKey: 'fs.search' },
  Bash: { nodeType: 'tool.bash', groupKey: 'cmd' },
  RunScript: { nodeType: 'tool.run_script', groupKey: 'cmd' },
  WebFetch: { nodeType: 'tool.web_fetch', groupKey: 'web.fetch' },
  WebSearch: { nodeType: 'tool.web_search', groupKey: 'web.search' },
  QuickSearch: { nodeType: 'tool.kb_search', groupKey: 'kb.search' },
  MemorySearch: { nodeType: 'tool.memory_search', groupKey: 'kb.search' },
  Skill: { nodeType: 'tool.skill', groupKey: null },
  Sleep: { nodeType: 'tool.sleep', groupKey: 'sys' },
  TaskList: { nodeType: 'tool.task_query', groupKey: 'task.query' },
  TaskGet: { nodeType: 'tool.task_query', groupKey: 'task.query' },
  TeamDelete: { nodeType: 'tool.team_ops', groupKey: 'team.query' },
  TeamList: { nodeType: 'tool.team_ops', groupKey: 'team.query' },
  TeamGetTasks: { nodeType: 'tool.team_ops', groupKey: 'team.query' },
  Cron: { nodeType: 'tool.cron', groupKey: 'sys' },
  SendMessage: { nodeType: 'tool.notify', groupKey: 'sys' },
}

/** TaskCreate / TaskUpdate：不落工具节点，按 taskId 对 task 实体幂等 upsert（归一规则 3） */
export const TASK_UPSERT_TOOLS = new Set(['TaskCreate', 'TaskUpdate'])

/** 实体协作工具：SubAgent → subagent、CollectResults → collect、TeamCreate → team（AskUser 不产生 tool_exec 消息） */
export const SUBAGENT_TOOL = 'SubAgent'
export const COLLECT_TOOL = 'CollectResults'
export const TEAM_CREATE_TOOL = 'TeamCreate'
