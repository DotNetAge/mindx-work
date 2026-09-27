// 节点通用壳（NodeBase）——全树 32 种节点类型共享的生命周期与统一名片载体。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §2.1 判别联合「通用壳 + 专用芯」：
// 壳保证名片长相统一（状态/时长/耗时/审批徽标），芯（各族类型文件）保证数据不撒谎。
// 构建器（builder/）产出类型化节点后，raw eventData 不外泄，下游不得重新解析原始事件。

/** 节点生命周期四态：视图层据此着色（executing=流光 / success=绿 / attention=黄 / failed=红）。
 *  注意「attention（需要留意的成功与提醒）」是渲染层由类型+数据推导的视觉态，不是 status 原语。 */
export type NodeStatus = 'executing' | 'success' | 'failed' | 'cancelled'

/** 审批留痕（工具节点的审批徽标供给；permission 节点的决定记录在自身 payload.decision） */
export type NodeApproval = 'none' | 'granted' | 'session-granted' | 'denied'

/**
 * 节点壳：全类型共享字段。
 * - id：轮内唯一（构建器生成）；
 * - startedAt：轮内偏移毫秒（相对轮首），时间维度阈值化呈现的供给（§3.5）；
 * - durationMs：执行时长，超阈值（2s）才在名片显示；
 * - tokens：该节点消耗的 LLM tokens（工具事件回填的真实 usage）；
 * - foldDefault：折叠策略的每类型静态声明，作为折叠 UI 态覆盖 Map 的初值（取舍 15）；
 *   折叠 UI 态本身不进节点数据、不持久化。
 */
export interface NodeBase {
  id: string
  status: NodeStatus
  startedAt: number
  durationMs?: number
  tokens?: number
  approval?: NodeApproval
  foldDefault: boolean
}

/**
 * 工具聚合类别（groupKey）——每种工具节点类型静态声明，group 节点由构建器
 * 对「相邻同 groupKey 工具段」聚合产生（§2.3，取舍 3：只做相邻同类聚合）。
 * null 表示该类型不聚合（如 Skill 关键动作）。
 */
export type GroupKey =
  | 'fs.read'      // 文件读取
  | 'fs.write'     // 文件写入/编辑
  | 'fs.browse'    // 目录浏览/文件匹配
  | 'fs.search'    // 内容搜索
  | 'cmd'          // 命令执行
  | 'web.fetch'    // 网页抓取
  | 'web.search'   // 联网搜索
  | 'kb.search'    // 知识库/记忆检索
  | 'task.query'   // 任务查询
  | 'team.query'   // 团队查询
  | 'sys'          // 系统操作（定时/通知/等待）
