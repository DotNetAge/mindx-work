/**
 * docpreview 插件 store：文档打开状态（Model）。
 * 数据通道：daemon fs.read_base64（返回 { content, mime }，handler_fs 实证）。
 * PDF → Blob URL（Chromium 内置查看器 iframe 直出）；docx/pptx/xlsx →
 * ArrayBuffer 交 DetailPanel 由前端库渲染。壳引用装配期捕获，store 顶部零 inject 依赖。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const DOC_PREVIEW_DETAIL_ID = 'doc-preview-detail'

/** 预览类别（扩展名路由） */
export type DocKind = 'pdf' | 'docx' | 'xlsx' | 'pptx'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindDocPreviewShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('docpreview 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明 ───────────────────────────────────────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 扩展名提取（小写，无扩展返回空串） */
function extOf(path: string): string {
  const base = path.split('/').pop() || path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 扩展名 → 预览类别（不支持的格式返回 null） */
function kindOf(ext: string): DocKind | null {
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx') return 'xlsx'
  if (ext === 'pptx') return 'pptx'
  return null
}

/** base64 → 字节（fs.read_base64 内容转二进制；标注 ArrayBuffer 后备保证 .buffer 非 SharedArrayBuffer） */
function base64ToBytes(content: string): Uint8Array<ArrayBuffer> {
  const bin = atob(content)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ── store ────────────────────────────────────────────────────────────────────

export const useDocPreviewStore = defineStore('doc-preview-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 当前文档绝对路径（空 = 未打开） */
  const currentFile = ref('')
  /** 预览类别（null = 未打开或不支持） */
  const kind = ref<DocKind | null>(null)
  /** PDF Blob URL（iframe 直出，用后释放防泄漏） */
  const blobUrl = ref('')
  /** docx/pptx/xlsx 渲染字节（组件挂载后交库渲染） */
  const payload = ref<ArrayBuffer | null>(null)
  const loading = ref(false)
  const error = ref('')

  /** 剥离 grep 命中行传入的 `:行号` 尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /** 释放 Blob URL（重复打开防泄漏） */
  function releaseBlob(): void {
    if (blobUrl.value) {
      URL.revokeObjectURL(blobUrl.value)
      blobUrl.value = ''
    }
  }

  /** 命令 action（契约 §10.3 范式）：打开文档到详情轨道 */
  async function open(target: string): Promise<void> {
    const path = stripLineSuffix(target.trim())
    if (!path) return
    const k = kindOf(extOf(path))
    currentFile.value = path
    kind.value = k
    error.value = k ? '' : '该格式暂不支持预览（支持 pdf / docx / xlsx / pptx）'
    payload.value = null
    releaseBlob()
    if (!k) {
      theShell().Detail.show(DOC_PREVIEW_DETAIL_ID)
      return
    }
    loading.value = true
    try {
      const result = await daemon.call<{ content: string; mime: string }>('fs.read_base64', {
        path,
      })
      if (k === 'pdf') {
        blobUrl.value = URL.createObjectURL(
          new Blob([base64ToBytes(result.content)], { type: 'application/pdf' }),
        )
      } else {
        payload.value = base64ToBytes(result.content).buffer
      }
      theShell().Detail.show(DOC_PREVIEW_DETAIL_ID)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  return { currentFile, kind, blobUrl, payload, loading, error, open }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type DocPreviewStore = ReturnType<typeof useDocPreviewStore>

export interface DocPreviewService {
  readonly store: DocPreviewStore
}

export function createDocPreviewService(): DocPreviewService {
  return {
    get store() {
      return useDocPreviewStore()
    },
  }
}
