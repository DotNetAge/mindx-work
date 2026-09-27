// NodeVisitor：非视图逻辑的穷尽性访问器（§4.2 穷尽性而非仪式）。
//
// 名片文案、组头摘要、操作声明、审计导出等非视图逻辑实现此接口，
// 每节点类型一个方法；漏实现任何类型时 TypeScript 编译报错，杜绝静默缺陷。
// 视图分派不用 Visitor（registry/components.ts 组件注册表即分派），不引入双分派仪式。

import type { TreeNode } from './index'
import type { ContentNode, GroupNode, ThinkingNode } from './content'
import type { CollectNode, SubagentNode, TaskNode, TeamNode } from './entity'
import type {
  AskUserNode,
  CancelledNode,
  CompactionNode,
  ErrorNode,
  LlmRetryNode,
  MaxTurnsNode,
  PermissionNode,
} from './system'
import type {
  BashToolNode,
  CronToolNode,
  EditToolNode,
  GlobToolNode,
  GrepToolNode,
  KbSearchToolNode,
  LsToolNode,
  MemorySearchToolNode,
  NotifyToolNode,
  ReadToolNode,
  RunScriptToolNode,
  SkillToolNode,
  SleepToolNode,
  TaskQueryToolNode,
  TeamOpsToolNode,
  WebFetchToolNode,
  WebSearchToolNode,
  WriteToolNode,
} from './tool'

export interface NodeVisitor<T> {
  // 族 1：执行内容
  content(node: ContentNode): T
  thinking(node: ThinkingNode): T
  group(node: GroupNode): T
  // 族 2：实体与协作
  task(node: TaskNode): T
  team(node: TeamNode): T
  subagent(node: SubagentNode): T
  collect(node: CollectNode): T
  // 族 3：阻塞与系统
  permission(node: PermissionNode): T
  askUser(node: AskUserNode): T
  error(node: ErrorNode): T
  compaction(node: CompactionNode): T
  maxTurns(node: MaxTurnsNode): T
  llmRetry(node: LlmRetryNode): T
  cancelled(node: CancelledNode): T
  // 族 4：工具（18 种）
  read(node: ReadToolNode): T
  write(node: WriteToolNode): T
  edit(node: EditToolNode): T
  ls(node: LsToolNode): T
  glob(node: GlobToolNode): T
  grep(node: GrepToolNode): T
  bash(node: BashToolNode): T
  runScript(node: RunScriptToolNode): T
  webFetch(node: WebFetchToolNode): T
  webSearch(node: WebSearchToolNode): T
  kbSearch(node: KbSearchToolNode): T
  memorySearch(node: MemorySearchToolNode): T
  skill(node: SkillToolNode): T
  sleep(node: SleepToolNode): T
  taskQuery(node: TaskQueryToolNode): T
  teamOps(node: TeamOpsToolNode): T
  cron(node: CronToolNode): T
  notify(node: NotifyToolNode): T
}

/** 穷尽性断言：switch 全覆盖后 default 分支的入参为 never，漏类型时此处编译报错 */
export function assertNever(value: never, context = ''): never {
  throw new Error(`未处理的节点类型${context ? '（' + context + '）' : ''}: ${JSON.stringify(value)}`)
}

/** 按节点类型分派到 visitor 对应方法（穷尽性由返回值类型约束保证） */
export function visitNode<T>(node: TreeNode, visitor: NodeVisitor<T>): T {
  switch (node.type) {
    // 族 1：执行内容
    case 'content': return visitor.content(node)
    case 'thinking': return visitor.thinking(node)
    case 'group': return visitor.group(node)
    // 族 2：实体与协作
    case 'task': return visitor.task(node)
    case 'team': return visitor.team(node)
    case 'subagent': return visitor.subagent(node)
    case 'collect': return visitor.collect(node)
    // 族 3：阻塞与系统
    case 'permission': return visitor.permission(node)
    case 'ask_user': return visitor.askUser(node)
    case 'error': return visitor.error(node)
    case 'compaction': return visitor.compaction(node)
    case 'max_turns': return visitor.maxTurns(node)
    case 'llm_retry': return visitor.llmRetry(node)
    case 'cancelled': return visitor.cancelled(node)
    // 族 4：工具
    case 'tool.read': return visitor.read(node)
    case 'tool.write': return visitor.write(node)
    case 'tool.edit': return visitor.edit(node)
    case 'tool.ls': return visitor.ls(node)
    case 'tool.glob': return visitor.glob(node)
    case 'tool.grep': return visitor.grep(node)
    case 'tool.bash': return visitor.bash(node)
    case 'tool.run_script': return visitor.runScript(node)
    case 'tool.web_fetch': return visitor.webFetch(node)
    case 'tool.web_search': return visitor.webSearch(node)
    case 'tool.kb_search': return visitor.kbSearch(node)
    case 'tool.memory_search': return visitor.memorySearch(node)
    case 'tool.skill': return visitor.skill(node)
    case 'tool.sleep': return visitor.sleep(node)
    case 'tool.task_query': return visitor.taskQuery(node)
    case 'tool.team_ops': return visitor.teamOps(node)
    case 'tool.cron': return visitor.cron(node)
    case 'tool.notify': return visitor.notify(node)
  }
}
