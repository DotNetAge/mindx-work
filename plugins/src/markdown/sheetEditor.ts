/**
 * 通用 Markdown Sheet 编辑器的唤起辅助（壳契约「业务数据不走 props」：
 * 编辑目标经本模块的单例草稿态传递，MarkdownEditorSheet 组件挂载时读取）。
 * 同一时刻只持有一个编辑 Sheet，重复唤起先移除旧条目防叠加。
 */
import { ref } from 'vue'
import type { useShell } from '@mindx-work/ui-shell-vue'

type Shell = ReturnType<typeof useShell>

/** 编辑目标（唤起时写入，保存/取消后清空） */
export interface MarkdownSheetDraft {
  /** Overlay 条目 id（调用方命名空间内唯一） */
  id: string
  /** 初始正文 */
  value: string
  /** 空内容占位提示 */
  placeholder?: string
  /** 保存回调：拒绝（RPC 失败）时 Sheet 保持打开，由调用方负责错误反馈 */
  onSave(value: string): void | Promise<void>
}

const draft = ref<MarkdownSheetDraft | null>(null)

/** 当前编辑目标（MarkdownEditorSheet 挂载时读取快照） */
export const sheetDraft = draft

/** 唤起 Markdown 编辑 Sheet（title 显示在 Sheet 头部） */
export function openMarkdownSheet(shell: Shell, opts: MarkdownSheetDraft & { title: string }): void {
  if (shell.Sheet.has(opts.id)) shell.Sheet.remove(opts.id)
  void import('./MarkdownEditorSheet.vue').then(({ default: EditorSheet }) => {
    draft.value = { id: opts.id, value: opts.value, placeholder: opts.placeholder, onSave: opts.onSave }
    shell.Sheet.add({ id: opts.id, title: opts.title, component: EditorSheet as never })
  })
}

/** 关闭当前编辑 Sheet（保存成功与取消共用） */
export function closeMarkdownSheet(shell: Shell): void {
  if (draft.value) shell.Sheet.remove(draft.value.id)
  draft.value = null
}
