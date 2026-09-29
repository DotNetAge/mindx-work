/**
 * codeeditor 插件 store：代码文件内容状态 + 保存命令（Model）。
 *
 * 结构同构 markdown 插件：daemon fs.read / fs.write（返回形状以 handler_fs.go
 * 实证为准）；壳引用经 bindCodeEditorShell 装配期捕获，store 顶部零 inject 依赖。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessageBox } from 'element-plus'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const CODEEDITOR_DETAIL_ID = 'codeeditor-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindCodeEditorShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('codeeditor 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明 ───────────────────────────────────────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

// ── store ────────────────────────────────────────────────────────────────────

export const useCodeEditorStore = defineStore('codeeditor-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 当前文件绝对路径（空 = 未打开） */
  const currentFile = ref('')
  /** 文件内容（磁盘态）与编辑态分离，dirty = 二者不一致 */
  const diskContent = ref('')
  const code = ref('')
  const dirty = computed(() => code.value !== diskContent.value)
  const loading = ref(false)
  const saving = ref(false)
  /** 打开失败信息（fs.read 失败等；空 = 无错误） */
  const error = ref('')

  /** 剥离 grep 命中行传入的 `:行号` 尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /**
   * 命令 action（契约 §10.3 范式）：打开代码文件到详情轨道。
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
      code.value = result.content
      theShell().Detail.show(CODEEDITOR_DETAIL_ID)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** 编辑绑定：写 code，置脏（computed dirty 派生，无需手动标记） */
  function setCode(value: string): void {
    code.value = value
  }

  /** 保存：fs.write 写回磁盘，成功后磁盘态对齐 */
  async function save(): Promise<void> {
    if (!currentFile.value || saving.value) return
    saving.value = true
    try {
      await daemon.call<{ status: string }>('fs.write', {
        path: currentFile.value,
        content: code.value,
      })
      diskContent.value = code.value
    } finally {
      saving.value = false
    }
  }

  return {
    currentFile,
    code,
    dirty,
    loading,
    saving,
    error,
    open,
    setCode,
    save,
  }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type CodeEditorStore = ReturnType<typeof useCodeEditorStore>

export interface CodeEditorService {
  readonly store: CodeEditorStore
}

export function createCodeEditorService(): CodeEditorService {
  return {
    get store() {
      return useCodeEditorStore()
    },
  }
}
