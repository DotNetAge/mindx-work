// nodes/ 总出口：节点视图组件显式列出（PR §7.1）。
// registry/components.ts 从此处集中 import（显式列出，不做自注册魔法）；
// shell 不 import 任何具体节点，依赖方向单向：types ← registry ← shell，nodes/* ← 现役组件。
// 二期 A 落简单节点视图；二期 B 补齐复杂节点视图（工具类 9 件 + 实体协作/阻塞 6 件）。

export { ContentView } from './content'
export { ThinkingNodeView } from './thinking'
export { ErrorNodeView } from './error'
export { CompactionNodeView } from './compaction'
export { MaxTurnsNodeView } from './max-turns'
export { LlmRetryNodeView } from './llm-retry'
export { CancelledNodeView } from './cancelled'

// 族 2：实体与协作（二期 B）
export { TaskNodeView } from './task'
export { TeamNodeView } from './team'
export { SubagentNodeView } from './subagent'
export { CollectNodeView } from './collect'

// 族 3：阻塞与系统（ask_user / permission 随二期 B 平移）
export { AskUserNodeView } from './ask-user'
export { PermissionNodeView } from './permission'

// 族 4：工具
export { WriteNodeView } from './write'
export { EditNodeView } from './edit'
export { LsNodeView } from './ls'
export { GlobNodeView } from './glob'
export { GrepNodeView } from './grep'
export { BashNodeView } from './bash'
export { NotifyNodeView } from './notify'
export { RunScriptNodeView } from './run-script'
export { WebFetchNodeView } from './web-fetch'
export { WebSearchNodeView } from './web-search'
export { KbSearchNodeView } from './kb-search'
export { MemorySearchNodeView } from './memory-search'
export { SkillNodeView } from './skill'
export { TaskQueryNodeView } from './task-query'
export { TeamOpsNodeView } from './team-ops'
export { CronNodeView } from './cron'
