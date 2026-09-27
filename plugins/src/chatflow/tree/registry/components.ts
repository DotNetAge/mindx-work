// registry/components.ts —— 节点视图注册表（§3.2 / §4.2：type → Vue component，<component :is> 分派）。
//
// - 新增一个工具的成本 = nodes/ 一个文件夹 + 本表加一行，树壳零改动（开闭原则落在工具维度）；
// - 表按全量 TreeNodeType 键控（值允许 null），漏类型编译报错；
// - standalone：全卡直渲形态——视图自带 header/折叠/正文（content/thinking/subagent），
//   树壳不套统一名片、不提供展开容器；group 为树壳内建形态（组头 + children 递归），表内置 null；
// - sleep 无展开态（PR 对照表「—」），仅统一名片承载，表内置 null。
//
// 移植分期（mindx-work）：二期 A 落简单节点视图（content/thinking/bash/ls/glob/grep/
// write/edit/error/cancelled/compaction/max_turns/llm_retry/notify）；二期 B 补齐复杂
// 节点视图（工具类 9 件 + 实体协作/阻塞 6 件，subagent 为全卡直渲形态）。

import type { Component } from 'vue'
import type { TreeNode, TreeNodeType } from '../types'
import { slotViewOf } from '../../slot/registry'
import {
  AskUserNodeView, BashNodeView, CancelledNodeView, CollectNodeView,
  CompactionNodeView, ContentView, CronNodeView, ErrorNodeView, GlobNodeView,
  GrepNodeView, KbSearchNodeView, LlmRetryNodeView, LsNodeView, MaxTurnsNodeView,
  MemorySearchNodeView, NotifyNodeView, PermissionNodeView, RunScriptNodeView,
  SkillNodeView, SubagentNodeView, TaskNodeView, TaskQueryNodeView,
  TeamNodeView, TeamOpsNodeView, ThinkingNodeView, WebFetchNodeView,
  WebSearchNodeView, WriteNodeView, EditNodeView,
} from '../nodes'

export interface NodeViewEntry {
  view: Component
  /** 全卡直渲：树壳不套统一名片（视图自成一体，无展开容器） */
  standalone?: boolean
}

type NodeViewTable = { [K in TreeNodeType]: NodeViewEntry | null }

const NODE_VIEWS: NodeViewTable = {
  // 族 1：执行内容（group 树壳内建，不入表）
  content: { view: ContentView, standalone: true },
  thinking: { view: ThinkingNodeView, standalone: true },
  group: null,

  // 族 2：实体与协作（subagent 全卡直渲：视图自带行头/折叠/内联直播子树）
  task: { view: TaskNodeView },
  team: { view: TeamNodeView },
  subagent: { view: SubagentNodeView, standalone: true },
  collect: { view: CollectNodeView },

  // 族 3：阻塞与系统
  permission: { view: PermissionNodeView },
  ask_user: { view: AskUserNodeView },
  error: { view: ErrorNodeView },
  compaction: { view: CompactionNodeView },
  max_turns: { view: MaxTurnsNodeView },
  llm_retry: { view: LlmRetryNodeView },
  cancelled: { view: CancelledNodeView },

  // 族 4：工具（sleep 无展开态，仅名片）
  'tool.read': null,
  'tool.write': { view: WriteNodeView },
  'tool.edit': { view: EditNodeView },
  'tool.ls': { view: LsNodeView },
  'tool.glob': { view: GlobNodeView },
  'tool.grep': { view: GrepNodeView },
  'tool.bash': { view: BashNodeView },
  'tool.run_script': { view: RunScriptNodeView },
  'tool.web_fetch': { view: WebFetchNodeView },
  'tool.web_search': { view: WebSearchNodeView },
  'tool.kb_search': { view: KbSearchNodeView },
  'tool.memory_search': { view: MemorySearchNodeView },
  'tool.skill': { view: SkillNodeView },
  'tool.sleep': null,
  'tool.task_query': { view: TaskQueryNodeView },
  'tool.team_ops': { view: TeamOpsNodeView },
  'tool.cron': { view: CronNodeView },
  'tool.notify': { view: NotifyNodeView },
}

/**
 * 节点视图查询：type → { view, standalone } | null。
 * 查找链 = 贡献层优先、内建层兜底（五期槽位）：槽位登记的类型返回贡献视图条目
 * （SlotViewEntry 与 NodeViewEntry 结构同形）；未登记回落内建表（未登记键得 null）。
 * 树壳消费此出口分派展开态/全卡视图，不 import 任何具体节点（§7.1 依赖方向）。
 */
export function viewOf(node: TreeNode): NodeViewEntry | null {
  const slot = slotViewOf(node.type)
  if (slot) return slot as NodeViewEntry
  return NODE_VIEWS[node.type] ?? null
}
