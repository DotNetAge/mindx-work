/**
 * svgboard 插件 store：SVG 矢量画板文件状态与画布核心状态（Model）。
 * 数据通道：daemon fs.read_base64（读，base64 解码为 SVG 文本）+ fs.write（写，
 * 覆盖原文件；explorer/store.ts 实证）。画布核心状态（图形/视口/选中/撤销栈）
 * 上移本 store：DetailPane 切 tab 即 v-if 卸载组件，状态留 store 免序列化恢复；
 * 纯交互态（绘制草稿/编辑浮层）归 DetailPanel。壳引用装配期捕获，store 顶部零 inject 依赖。
 */

import { markRaw, ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'
import { createShapeHistory } from './history'
import type { BoardShape, View } from './types'

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

/** 未落盘画板的文档指纹序号（剪贴板跨文档隔离用） */
let draftSeq = 0

// ── store ────────────────────────────────────────────────────────────────────

export const useSvgboardStore = defineStore('svgboard-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 当前文件绝对路径（空 = 未落盘的新画板） */
  const currentFile = ref('')
  /** 是否有未保存改动（保存成功后复位；文件 IO 不改它，由面板改） */
  const dirty = ref(false)
  const loading = ref(false)
  const error = ref('')
  /** 文档指纹：剪贴板复制/粘贴校验（open 取路径，create 取草稿序号），跨画板粘贴丢弃 */
  const boardKey = ref('')

  // ── 画布核心状态（组件卸载不丢：切 Detail tab 回来自动恢复）────────────────
  const shapes = ref<BoardShape[]>([])
  const selectedIds = ref<number[]>([])
  /** 文档逻辑边界：序列化基准（新建默认，导入取原文档，缩放平移永不改它） */
  const docBox = ref<View>({ x: 0, y: 0, w: 1000, h: 700 })
  /** 当前视口：滚轮/空格/抓手缩放平移只改它（初始 = 文档边界） */
  const view = ref<View>({ x: 0, y: 0, w: 1000, h: 700 })
  /** 图形 id 分配器（打开/新建时重置） */
  const nextId = ref(1)
  /** 撤销/重做双向快照栈（cap 50，结构见 history.ts；markRaw 防响应式深包装） */
  const hist = markRaw(createShapeHistory(shapes))

  /** 新建/打开前清空画布核心状态 */
  function resetBoard(): void {
    shapes.value = []
    selectedIds.value = []
    docBox.value = { x: 0, y: 0, w: 1000, h: 700 }
    view.value = { x: 0, y: 0, w: 1000, h: 700 }
    nextId.value = 1
    hist.clear()
  }

  /** 错误净化：daemon 原始错误可能携带绝对路径等技术细节，客户可见文案只留
   * 首行并剥除路径段（完整路径仅在诊断详情保留） */
  function sanitizeError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e)
    const firstLine = (raw.split('\n')[0] ?? raw).trim()
    const cleaned = firstLine
      .replace(/(?:\/[^\s:"]+)+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return cleaned || '操作失败'
  }

  /** 剥离 grep 命中行传入的 `:行号` 尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /** 新建空白画板（未落盘态，保存时走系统对话框选路径） */
  function create(): void {
    currentFile.value = ''
    error.value = ''
    dirty.value = false
    boardKey.value = `draft-${++draftSeq}`
    resetBoard()
    theShell().Detail.show(SVGBOARD_DETAIL_ID)
  }

  /** open 读回的 SVG 文本交接通道（面板消费一次即清） */
  const pendingText = ref('')

  /** 面板挂载期登记的画布序列化器（serialize 依赖组件内 shapes/vb 态；
   * 「添加到对话」先落盘再引用时取当前画布文本，面板卸载即注销） */
  const serializer = ref<(() => string) | null>(null)

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
      // base64 承载 UTF-8 文本必须经 TextDecoder（atob 按 Latin-1 解码，中文即乱码）
      const text = new TextDecoder().decode(Uint8Array.from(result.content, (c) => c.charCodeAt(0)))
      currentFile.value = path
      dirty.value = false
      boardKey.value = path
      // 文本经面板消费（面板未挂载时由挂载期 immediate watch 消费）
      pendingText.value = text
      theShell().Detail.show(SVGBOARD_DETAIL_ID)
    } catch (e) {
      error.value = sanitizeError(e)
    } finally {
      loading.value = false
    }
  }

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
      error.value = sanitizeError(e)
      return false
    }
  }

  /** 导出 PNG：dataURL 剥离前缀取纯 base64，系统对话框取路径后 fs.write_base64 落盘 */
  async function savePng(dataUrl: string): Promise<boolean> {
    const picked = await window.mxDesktop?.dialog.saveFile('drawing.png')
    if (!picked) return false
    try {
      await daemon.call('fs.write_base64', { path: picked, content: dataUrl.slice(dataUrl.indexOf(',') + 1) })
      return true
    } catch (e) {
      error.value = sanitizeError(e)
      return false
    }
  }

  return {
    currentFile, dirty, loading, error, pendingText, serializer, boardKey,
    shapes, selectedIds, docBox, view, nextId, hist,
    resetBoard, create, open, save, savePng,
  }
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
