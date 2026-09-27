// SubAgent 卡片本地持久化（源：mindx-desktop stores/subtaskPersistence.ts，机制原样保留）。
//
// 会话快照的滑动窗口压缩会把 SubAgent 工具调用与 CollectResults 结果滑出窗口，
// 重新加载后子任务卡片无从恢复（快照里已无数据）。实时对话时前端把子任务卡片
// 数据持久化到 localStorage，恢复时快照里缺失的子任务据此补齐渲染
// （builder/restore 恢复三路合成之二），保证恢复视图与流式对话一致。

export interface PersistedSubtask {
  session_id: string
  agent_name: string
  description: string
  success?: boolean
  answer?: string
  error?: string
  spawned_at: number
}

// 单条结果摘要的存储上限：超长结果截断存储（localStorage 容量有限，卡片摘要内滚动展示）
const PERSISTED_SUBTASK_ANSWER_LIMIT = 32 * 1024

function subtaskStoreKey(masterSessionId: string): string {
  return `mindx:subtasks:${masterSessionId}`
}

export function loadPersistedSubtasks(masterSessionId: string): PersistedSubtask[] {
  try {
    const raw = localStorage.getItem(subtaskStoreKey(masterSessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePersistedSubtasks(masterSessionId: string, entries: PersistedSubtask[]) {
  try {
    localStorage.setItem(subtaskStoreKey(masterSessionId), JSON.stringify(entries))
  } catch {
    // 存储失败（容量满/隐私模式）静默忽略：仅影响压缩后的恢复补齐，不影响实时功能
  }
}

/** 登记派发的子任务（实时 spawn 事件时调用）；同 session_id 幂等覆盖 */
export function persistSubtaskSpawn(masterSessionId: string, entry: { session_id: string; agent_name: string; description: string }) {
  if (!masterSessionId || !entry.session_id) return
  const entries = loadPersistedSubtasks(masterSessionId).filter(e => e.session_id !== entry.session_id)
  entries.push({ ...entry, spawned_at: Date.now() })
  savePersistedSubtasks(masterSessionId, entries)
}

/** 登记子任务完成状态（实时 completed 事件时调用）；未登记过派发的直接补一条完整记录 */
export function persistSubtaskCompletion(masterSessionId: string, entry: { session_id: string; success: boolean; answer?: string; error?: string }) {
  if (!masterSessionId || !entry.session_id) return
  const entries = loadPersistedSubtasks(masterSessionId)
  const target = entries.find(e => e.session_id === entry.session_id)
  if (target) {
    target.success = entry.success
    target.answer = (entry.answer || '').slice(0, PERSISTED_SUBTASK_ANSWER_LIMIT)
    target.error = (entry.error || '').slice(0, PERSISTED_SUBTASK_ANSWER_LIMIT)
  } else {
    entries.push({
      session_id: entry.session_id,
      agent_name: '',
      description: '',
      success: entry.success,
      answer: (entry.answer || '').slice(0, PERSISTED_SUBTASK_ANSWER_LIMIT),
      error: (entry.error || '').slice(0, PERSISTED_SUBTASK_ANSWER_LIMIT),
      spawned_at: Date.now()
    })
  }
  savePersistedSubtasks(masterSessionId, entries)
}

/** 会话删除时清理对应的子任务登记 */
export function clearPersistedSubtasks(masterSessionId: string) {
  try {
    localStorage.removeItem(subtaskStoreKey(masterSessionId))
  } catch {
    // 忽略清理失败
  }
}
