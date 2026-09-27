// subagent 恢复三路合成（§2.2 subagent 特殊机制第 3 条）。
//
// 恢复态的 subagent 节点来自三路数据源合成：
//   ① 主会话快照 SubAgent 消息（restore 后的 subtask_spawned 消息，含 arguments.task 恢复的任务描述）
//   ② localStorage subtaskPersistence 登记（快照滑动窗口清掉 SubAgent 调用后的旁路数据源）
//   ③ 旧 markdown 格式 subtask 历史消息（仅兼容存量，session_id 为空、无法关联，不参与合成）
// 本模块负责第二路：快照中缺失（压缩滑出窗口）的子任务从登记数据补齐节点。
//
// 位置不可恢复（特殊机制第 2 条）：滑出后原位置不可知，补齐节点只能追加最后一轮轮尾
// （restored_persisted_subtask_ 前缀，现役同款策略），名片标注「已恢复」——
// 全树唯一「节点位置可能失真」的特例。

import { reactive } from 'vue'
import type { PersistedSubtask } from '../../model/subtask'
import type { SubagentNode } from '../types/entity'
import type { RoundTree, SessionBuildState } from './index'

/** 补齐节点追加的目标轮：最后一轮（无轮次的空会话不处理） */
function targetRound(rounds: RoundTree[]): RoundTree | null {
  return rounds.length ? rounds[rounds.length - 1]! : null
}

/**
 * 恢复三路合成之三：localStorage 登记的子任务在快照中缺失时补齐到最后一轮轮尾。
 * 幂等：已存在的子会话 ID（快照恢复或本轮已补齐）跳过；与注册表双向同步，
 * 保证后续轮次构建（活跃轮重建）引用同一节点对象。
 */
export function mergePersistedSubtasks(
  rounds: RoundTree[],
  state: SessionBuildState,
  persisted: PersistedSubtask[]
): void {
  const round = targetRound(rounds)
  if (!round) return

  for (const entry of persisted) {
    if (!entry.session_id) continue
    if (state.subagentNodes.has(entry.session_id)) continue

    const node = reactive({
      id: `restored_persisted_subtask_${entry.session_id}`,
      type: 'subagent',
      agentName: entry.agent_name || '',
      taskDigest: entry.description || '',
      sessionId: entry.session_id,
      resultDigest: entry.success === true ? (entry.answer || '') : (entry.error || ''),
      status: entry.success === true ? 'success' : entry.success === false ? 'failed' : 'executing',
      startedAt: 0,
      restored: true,
      foldDefault: true,
    } satisfies SubagentNode)
    state.subagentNodes.set(entry.session_id, node)
    round.nodes.push(node)
  }
}
