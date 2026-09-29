/**
 * markdown 插件 store：文件内容状态 + 预览/编辑模式 + 保存命令（Model）。
 *
 * 数据通道：daemon fs.read / fs.write（返回形状以 handler_fs.go 实证为准）。
 * 壳引用经 bindMarkdownShell 装配期捕获，store 顶部零 inject 依赖。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessageBox } from 'element-plus'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const MARKDOWN_DETAIL_ID = 'markdown-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindMarkdownShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('markdown 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明 ───────────────────────────────────────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 视图模式：预览 / 编辑 */
export type MarkdownMode = 'preview' | 'edit'

// ── store ────────────────────────────────────────────────────────────────────

export const useMarkdownStore = defineStore('markdown-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 当前文件绝对路径（空 = 未打开） */
  const currentFile = ref('')
  /** 文件内容（磁盘态）与编辑态分离，dirty = 二者不一致 */
  const diskContent = ref('')
  const draft = ref('')
  const dirty = computed(() => draft.value !== diskContent.value)
  const mode = ref<MarkdownMode>('preview')
  const loading = ref(false)
  const saving = ref(false)
  /** 打开失败信息（fs.read 失败等；空 = 无错误） */
  const error = ref('')

  /** 剥离 grep 命中行传入的 `:行号` 尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /**
   * 命令 action（契约 §10.3 范式）：打开 markdown 文件到详情轨道。
   * 切换文件存在未保存修改时先确认（放弃则保持现状）。
   */
  async function open(target: string): Promise<void> {
    const path = stripLineSuffix(target.trim())
    if (!path) return
    if (dirty.value && path !== currentFile.value) {
      try {
        await ElMessageBox.confirm('当前文件有未保存的修改，切换后将丢弃。', '未保存的修改', {
          confirmButtonText: '丢弃并切换',
          cancelButtonText: '取消',
          type: 'warning',
        })
      } catch {
        return
      }
    }
    loading.value = true
    error.value = ''
    try {
      const result = await daemon.call<{ content: string }>('fs.read', { path })
      currentFile.value = path
      diskContent.value = result.content
      draft.value = result.content
      mode.value = 'preview'
      theShell().Detail.show(MARKDOWN_DETAIL_ID)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** 编辑绑定：写 draft，置脏（computed dirty 派生，无需手动标记） */
  function setDraft(value: string): void {
    draft.value = value
  }

  /** 切换视图模式 */
  function setMode(next: MarkdownMode): void {
    mode.value = next
  }

  /** 保存：fs.write 写回磁盘，成功后磁盘态对齐 */
  async function save(): Promise<void> {
    if (!currentFile.value || saving.value) return
    saving.value = true
    try {
      await daemon.call<{ status: string }>('fs.write', {
        path: currentFile.value,
        content: draft.value,
      })
      diskContent.value = draft.value
    } finally {
      saving.value = false
    }
  }

  return {
    currentFile,
    draft,
    dirty,
    mode,
    loading,
    saving,
    error,
    open,
    setDraft,
    setMode,
    save,
  }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type MarkdownStore = ReturnType<typeof useMarkdownStore>

export interface MarkdownService {
  readonly store: MarkdownStore
}

export function createMarkdownService(): MarkdownService {
  return {
    get store() {
      return useMarkdownStore()
    },
  }
}
