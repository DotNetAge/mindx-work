/**
 * image-viewer 插件 store：图片打开状态（Model）。
 * 数据通道：daemon fs.read_base64（返回 { content, mime }，handler_fs.go 实证），
 * 前端拼 data URL 直出。壳引用装配期捕获，store 顶部零 inject 依赖。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const IMAGE_VIEWER_DETAIL_ID = 'image-viewer-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindImageViewerShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('image-viewer 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明 ───────────────────────────────────────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

// ── store ────────────────────────────────────────────────────────────────────

export const useImageViewerStore = defineStore('image-viewer-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 当前图片绝对路径（空 = 未打开） */
  const currentFile = ref('')
  /** data URL（fs.read_base64 content + mime 拼装） */
  const dataUrl = ref('')
  const loading = ref(false)
  const error = ref('')

  /** 剥离 grep 命中行传入的 `:行号` 尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /** 命令 action（契约 §10.3 范式）：打开图片到详情轨道 */
  async function open(target: string): Promise<void> {
    const path = stripLineSuffix(target.trim())
    if (!path) return
    loading.value = true
    error.value = ''
    try {
      const result = await daemon.call<{ content: string; mime: string }>('fs.read_base64', {
        path,
      })
      currentFile.value = path
      dataUrl.value = `data:${result.mime};base64,${result.content}`
      theShell().Detail.show(IMAGE_VIEWER_DETAIL_ID)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  return { currentFile, dataUrl, loading, error, open }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type ImageViewerStore = ReturnType<typeof useImageViewerStore>

export interface ImageViewerService {
  readonly store: ImageViewerStore
}

export function createImageViewerService(): ImageViewerService {
  return {
    get store() {
      return useImageViewerStore()
    },
  }
}
