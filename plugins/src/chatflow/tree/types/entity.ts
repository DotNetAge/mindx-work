// 族 2：实体与协作节点（4 种）——task / team / subagent / collect。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §2.2 族 2 与 §2.2 归一规则 3/4/11。
// - task：TaskCreate/TaskUpdate 不落工具节点，按 taskId 幂等 upsert 实体卡
//   （首次创建位置固定，后续原位更新状态与清单快照）；
// - subagent：subtask 双事件 upsert 单卡片（spawned 创建、completed 原位更新），
//   一阶段展开态沿用 SubAgentView 卡片不挂子树（迁移路径 §7）。

import type { NodeBase } from './base'

/** 任务状态流转记录（审计：每次 TaskUpdate 追加一条） */
export interface TaskTransition {
  /** 流转后的任务状态（pending/in_progress/completed/cancelled） */
  status: string
  /** 流转时间戳（ms） */
  at: number
}

/** 清单快照条目：upsert 时刻任务看板的逐任务状态（供展开态复现当时布局） */
export interface TaskSnapshotItem {
  taskId: string
  subject: string
  status: string
  activeForm?: string
}

/** 任务实体卡（叶子状态卡，不挂执行子树——取舍 2：并行交错时工具流无法可靠归属任务） */
export interface TaskNode extends NodeBase {
  type: 'task'
  taskId: string
  subject: string
  activeForm?: string
  /** 任务自身状态。与壳的 status（节点生命周期）刻意区分命名，避免语义混淆 */
  taskStatus: string
  /** upsert 时刻的任务看板快照 */
  checklistSnapshot?: TaskSnapshotItem[]
  transitions: TaskTransition[]
}

/** 团队成员（TeamCreate 参数投影） */
export interface TeamMember {
  name: string
  role?: string
}

/** 团队创建卡 */
export interface TeamNode extends NodeBase {
  type: 'team'
  teamName: string
  members: TeamMember[]
  description?: string
}

/**
 * 子任务卡（全树最复杂节点，§2.2 subagent 特殊机制）：
 * - 身份与状态来自主会话流 subtask 双事件；
 * - children：子代理全过程内联直播节点（工作块 E）。主回合存续期间子代理 delta
 *   全程到达前端（envelope.session_id=子会话 ID），树构建器按子会话消息流
 *   归一化为嵌套节点挂接于此（复用现有归一化逻辑，树深可递归到孙代理）；
 *   执行中默认展开跟随，完成/失败后折叠为「共 N 步」摘要；
 * - restored：localStorage 旁路补齐的节点（快照滑出窗口后位置失真，只能追加轮尾，
 *   全树唯一「节点位置可能失真」的特例，名片标注「已恢复」）；
 * - resultDigest：完成后的结果摘要（subtask_completed.answer）。
 */
export interface SubagentNode extends NodeBase {
  type: 'subagent'
  agentName: string
  taskDigest: string
  /** 子会话 ID（子树懒加载、打开子会话的锚点） */
  sessionId?: string
  /** 子代理全过程嵌套节点（内联直播，构建器从子会话消息流归一化生成） */
  children?: import('./index').TreeNode[]
  resultDigest?: string
  restored?: boolean
}

/** 结果收集卡（CollectResults）：按 sessionId 关联对应 subagent 节点 */
export interface CollectNode extends NodeBase {
  type: 'collect'
  sessionIds: string[]
  resultDigests: string[]
}
