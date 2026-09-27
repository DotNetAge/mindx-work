// group 节点缓冲：相邻同 groupKey 工具段的聚合器（§2.3，取舍 3——只做相邻同类聚合）。
//
// builder 主流程在遇到工具节点时入缓冲；遇到任何非工具节点、异类别工具或轮尾时冲刷：
// 缓冲内只有一个成员时直接落工具节点本身（不包组壳），多于一个时归一化为 group 节点，
// 组头 summarize(n) 由成员类型推导（registry/summary.ts），分组规则与组头措辞零特判。

import type { GroupNode } from '../types/content'
import type { GroupKey } from '../types/base'
import type { ToolNode } from '../types/tool'

/** 组缓冲状态（builder 主流程持有，随构建过程进出） */
export interface GroupBuffer {
  groupKey: GroupKey
  members: ToolNode[]
}

/**
 * 冲刷缓冲为节点序列：单成员去壳、多成员聚合为 group。
 * 返回冲刷产生的节点（0 个或 1 个），调用方按序追加。
 */
export function flushGroupBuffer(buffer: GroupBuffer | null): ToolNode | GroupNode | null {
  if (!buffer || buffer.members.length === 0) return null
  if (buffer.members.length === 1) return buffer.members[0]!

  const first = buffer.members[0]!
  const last = buffer.members[buffer.members.length - 1]!
  // 组内时序跨度：末成员起点 + 时长 − 首成员起点；无时长数据时省略
  let durationMs: number | undefined
  const endOffset = last.startedAt + (last.durationMs ?? 0)
  if (endOffset > first.startedAt) durationMs = endOffset - first.startedAt

  return {
    id: `group_${first.id}`,
    type: 'group',
    groupKey: buffer.groupKey,
    children: buffer.members,
    // 组状态由成员推导：任一执行中 → executing；任一失败 → failed；否则成功
    status: buffer.members.some(m => m.status === 'executing')
      ? 'executing'
      : buffer.members.some(m => m.status === 'failed')
        ? 'failed'
        : 'success',
    startedAt: first.startedAt,
    durationMs,
    foldDefault: true,
  }
}

/**
 * 工具节点入缓冲。同 groupKey 追加；异类别（含 groupKey=null 的关键动作）先冲刷再开新缓冲。
 * 返回冲刷产生的节点（可能为 null），调用方按序追加后再处理新缓冲。
 */
export function pushToGroupBuffer(
  buffer: GroupBuffer | null,
  node: ToolNode,
  groupKey: GroupKey | null
): { flushed: ToolNode | GroupNode | null; buffer: GroupBuffer | null } {
  // 不聚合类型：冲掉现有缓冲后独立落卡
  if (groupKey === null) {
    return { flushed: flushGroupBuffer(buffer), buffer: null }
  }
  // 同类别：追加
  if (buffer && buffer.groupKey === groupKey) {
    buffer.members.push(node)
    return { flushed: null, buffer }
  }
  // 异类别：冲刷旧缓冲，开新缓冲（成员暂存，延迟到冲刷时才生成 group 节点，
  // 保证组状态能反映成员的最新生命周期）
  return { flushed: flushGroupBuffer(buffer), buffer: { groupKey, members: [node] } }
}
