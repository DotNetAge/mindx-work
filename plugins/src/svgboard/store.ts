/**
 * svgboard 插件 store：SVG 矢量画板文件状态（Model）。
 * 数据通道：daemon fs.read_base64（读，base64 解码为 SVG 文本）+ fs.write（写，
 * 覆盖原文件；explorer/store.ts 实证）。画布图形状态归 DetailPanel（纯交互 UI），
 * 本 store 只管文件 IO 与详情轨道唤起。壳引用装配期捕获，store 顶部零 inject 依赖。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const SVGBOARD_DETAIL_ID = 'svgboard-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindSvgboardShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('svgboard 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明 ───────────────────────────────────────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

// ── store ────────────────────────────────────────────────────────────────────

export const useSvgboardStore = defineStore('svgboard-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 当前文件绝对路径（空 = 未落盘的新画板） */
  const currentFile = ref('')
  /** 是否有未保存改动（保存成功后复位；文件 IO 不改它，由面板改） */
  const dirty = ref(false)
  const loading = ref(false)
  const error = ref('')

  /** 剥离 grep 命中行传入的 `:行号` 尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /** 新建空白画板（未落盘态，保存时走系统对话框选路径） */
  function create(): void {
    currentFile.value = ''
    error.value = ''
    dirty.value = false
    theShell().Detail.show(SVGBOARD_DETAIL_ID)
  }

  /** 打开 SVG 文件到详情轨道（base64 读回解码为文本） */
  async function open(target: string): Promise<void> {
    const path = stripLineSuffix(target.trim())
    if (!path) return
    loading.value = true
    error.value = ''
    try {
      const result = await daemon.call<{ content: string; mime: string }>('fs.read_base64', {
        path,
      })
      const text = atob(result.content)
      currentFile.value = path
      dirty.value = false
      // 文本经面板消费（openStoreText 由面板 watch currentFile 读取）
      pendingText.value = text
      theShell().Detail.show(SVGBOARD_DETAIL_ID)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** open 读回的 SVG 文本交接通道（面板消费一次即清） */
  const pendingText = ref('')

  /** 面板挂载期登记的画布序列化器（serialize 依赖组件内 shapes/vb 态；
   * 「添加到对话」先落盘再引用时取当前画布文本，面板卸载即注销） */
  const serializer = ref<(() => string) | null>(null)

  /** 保存：已有路径覆盖写；新画板走系统保存对话框取路径（取消返回 false 保持 dirty） */
  async function save(svgText: string): Promise<boolean> {
    let path = currentFile.value
    if (!path) {
      const picked = await window.mxDesktop?.dialog.saveFile('drawing.svg')
      if (!picked) return false
      path = picked
    }
    try {
      await daemon.call('fs.write', { path, content: svgText })
      currentFile.value = path
      dirty.value = false
      error.value = ''
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /** 导出 PNG：dataURL 剥离前缀取纯 base64，系统对话框取路径后 fs.write_base64 落盘 */
  async function savePng(dataUrl: string): Promise<boolean> {
    const picked = await window.mxDesktop?.dialog.saveFile('drawing.png')
    if (!picked) return false
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    await daemon.call('fs.write_base64', { path: picked, content: base64 })
    return true
  }

  return { currentFile, dirty, loading, error, pendingText, serializer, create, open, save, savePng }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type SvgboardStore = ReturnType<typeof useSvgboardStore>

export interface SvgboardService {
  readonly store: SvgboardStore
}

export function createSvgboardService(): SvgboardService {
  return {
    get store() {
      return useSvgboardStore()
    },
  }
}
