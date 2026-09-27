// 节点判别联合出口 + 穷尽性工具（NodeVisitor）。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §2.2（32 种节点全目录）、§4.2（NodeVisitor
// 穷尽性而非仪式）。实现期不得绕过目录私加节点类型——新增类型必须先补设计文档目录。

export * from './base'
export * from './content'
export * from './entity'
export * from './system'
export * from './tool'
export * from './visitor'

import type { GroupNode, ContentNode, ThinkingNode } from './content'
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
import type { ToolNode } from './tool'

/** 树节点全量判别联合：3（执行内容）+ 4（实体协作）+ 7（阻塞系统）+ 18（工具）= 32 种 */
export type TreeNode =
  | ContentNode
  | ThinkingNode
  | GroupNode
  | TaskNode
  | TeamNode
  | SubagentNode
  | CollectNode
  | PermissionNode
  | AskUserNode
  | ErrorNode
  | CompactionNode
  | MaxTurnsNode
  | LlmRetryNode
  | CancelledNode
  | ToolNode

/** 全部节点类型名（由联合派生，保证与 TreeNode 永不脱节） */
export type TreeNodeType = TreeNode['type']

/** 类型守卫：工具节点族（group 的 children、轮 footer 变更摘要聚合的输入） */
export function isToolNode(node: TreeNode): node is ToolNode {
  return node.type.startsWith('tool.')
}

/** 类型守卫：group 节点（树壳递归渲染的分支依据） */
export function isGroupNode(node: TreeNode): node is GroupNode {
  return node.type === 'group'
}
