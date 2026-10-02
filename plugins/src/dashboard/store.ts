/**
 * dashboard（仪表板）插件 store：动态仪表板文件状态（Model）。
 * 仪表板文件 = 结构化标记单文件（HTML 方言解析，架构定稿 2026-09-30）：
 * <board> 根声明 name/gap，<card> 子节点声明 span/h/title，卡内任意
 * HTML/CSS/JS 即 Widget 本体——Agent 写静态网页 = 构建界面，无预置类型、
 * 无外部数据文件（此前八类注册表 + dataRef 方案已废弃，与「Skill 供给
 * 千变万化」的心智冲突）。
 * 命名：对外语义统一「仪表板」（.dash / .agents/dashboards/）——「仪表板」
 * 留给 Kanban 任务流语义，避免 Agent 歧义；代码标识符保留 kanban 词根。
 * 数据通道：daemon fs.list（清单）+ fs.read_base64（base64 经 UTF-8 解码，
 * atob 直转会中文乱码）。
 * 刷新通道：订阅 daemon tool_exec_end / loop_end，400ms trailing 合并静默
 * 重读（file_modified 仅工具执行前且仅首次入表发出，覆盖不了「写完即生效」）。
 * 工作区路径消费 chatflow.store 服务（try-catch 降级 null）。壳引用装配期捕获。
 */

import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const KANBAN_DETAIL_ID = 'kanban-detail'

/** 工具事件后统一等待时长（trailing：Agent 连写多文件只在最后一事件后触发一次） */
const RELOAD_DEBOUNCE_MS = 400

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindKanbanShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('dashboard 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明（插件间禁止 import，仅本地最小形状）────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

interface ChatflowServiceLike {
  readonly store: { currentProjectDir: string; isConnected: boolean }
}

// ── 仪表板协议类型与解析 ───────────────────────────────────────────────────────

/** 单卡（<card> 节点解析结果；html = 卡内 HTML 原文，渲染时入 iframe srcdoc） */
export interface KanbanCard {
  id: string
  /** 24 栏栅格占几栏（1..24，缺省 6） */
  span: number
  /** 初始高度 px（缺省 120，实际高度由卡内高度桥自适应上报） */
  h?: number
  title?: string
  /** class 属性（board 级 style 的选择器目标；随 board class 一起注入卡 iframe body） */
  classes: string[]
  html: string
}

/** 仪表板（<board> 根解析结果） */
export interface KanbanBoard {
  name: string
  /** 栅格列间距 px（0..48，缺省 12） */
  gap: number
  /** class 属性（注入每张卡 iframe body，配合 style 让共享样式一次作用全部卡） */
  classes: string[]
  /** board 级共享样式（<style> 直接子节点原文；注入每张卡 head，卡内自带样式可覆盖） */
  style: string
  cards: KanbanCard[]
}

/** 仪表板清单条目（Sidebar 节渲染用） */
export interface BoardListItem {
  path: string
  /** 文件名去 .dash 后缀（title 缺失时的回退与 tooltip 文件标识） */
  name: string
  /** <board name> 属性解析值（缺失/解析失败回退文件名） */
  title: string
}

/** fs.list 条目（消费侧本地形状） */
interface FsEntry {
  name: string
  path: string
  size: number
  is_dir: boolean
  mod_time: string
}

/** base64 → UTF-8 文本（atob 只产 Latin-1，中文必经 TextDecoder） */
function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** span 属性钳制（1..24 整数，缺省 6 = 一行四卡） */
function clampSpan(v: string | null): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 6
  return Math.min(24, Math.max(1, Math.round(n)))
}

/** gap 属性钳制（0..48，缺省 12） */
function clampGap(v: string | null): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 12
  return Math.min(48, Math.max(0, Math.round(n)))
}

/** h 属性解析（未设置返回 undefined） */
function parseH(v: string | null): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

/** class 属性解析（空白分隔多值；缺省空数组） */
function parseClasses(v: string | null): string[] {
  return (v || '').trim().split(/\s+/).filter(Boolean)
}

/** 清单标题轻解析：只取 <board name> 属性（宽容解析，缺失/失败返回空由调用方回退文件名） */
function peekBoardTitle(text: string): string {
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    return (doc.querySelector('board')?.getAttribute('name') || '').trim()
  } catch {
    return ''
  }
}

/**
 * 仪表板文本 → 结构。HTML 宽容解析（text/html）：board/card 为自定义标签，
 * 卡内任意合法 HTML5（style/script/未闭合标签/裸 & 均不炸）。
 * 只取 board 的直接子级 card（卡内禁嵌 board/card，SKILL 红线）；
 * 直接子级 <style> 是 board 级共享样式（注入每张卡，非卡片）。
 */
export function parseBoard(text: string, fallbackName: string): KanbanBoard {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const root = doc.querySelector('board')
  if (!root) throw new Error('仪表板格式无效：缺少 <board> 根节点')
  const cards = Array.from(root.querySelectorAll(':scope > card')).map((el, i) => ({
    id: el.getAttribute('id') || `card-${i + 1}`,
    span: clampSpan(el.getAttribute('span')),
    h: parseH(el.getAttribute('h')),
    title: el.getAttribute('title') || undefined,
    classes: parseClasses(el.getAttribute('class')),
    html: el.innerHTML,
  }))
  const boardStyle = Array.from(root.querySelectorAll(':scope > style'))
    .map((el) => el.textContent || '')
    .join('\n')
  return {
    name: root.getAttribute('name') || fallbackName,
    gap: clampGap(root.getAttribute('gap')),
    classes: parseClasses(root.getAttribute('class')),
    style: boardStyle,
    cards,
  }
}

// ── store ────────────────────────────────────────────────────────────────────

export const useKanbanStore = defineStore('kanban-store', () => {
  const shell = theShell()
  const daemon = shell.services.use<DaemonConnection>('daemon.connection')

  // chatflow 服务（对话插件可停用；服务为延迟外壳，.store 解引用才实例化）
  let chatflow: ChatflowServiceLike | null = null
  try {
    chatflow = shell.services.use<ChatflowServiceLike>('chatflow.store')
  } catch {
    chatflow = null
  }

  /** 当前仪表板文件绝对路径（空 = 未打开） */
  const currentFile = ref('')
  /** 已解析的仪表板（reload 静默替换，失败保留旧值） */
  const board = ref<KanbanBoard | null>(null)
  const loading = ref(false)
  const error = ref('')
  /** 当前工作区仪表板清单（Sidebar 节数据源） */
  const boardList = ref<BoardListItem[]>([])

  /** 工作区仪表板目录（跟随当前会话工作目录；无对话插件 / 未开目录 = 空） */
  const kanbansDir = computed(() => {
    const dir = (chatflow?.store.currentProjectDir || '').replace(/\/+$/, '')
    return dir ? dir + '/.agents/dashboards' : ''
  })

  /** 读仪表板文件并解析 */
  async function readBoard(path: string): Promise<KanbanBoard> {
    const result = await daemon.call<{ content: string; mime: string }>('fs.read_base64', { path })
    const base = path.split('/').pop() || path
    return parseBoard(decodeBase64Utf8(result.content), base.replace(/\.dash$/i, ''))
  }

  /** 打开仪表板到详情轨道 */
  async function open(target: string): Promise<void> {
    const path = target.trim()
    if (!path) return
    loading.value = true
    error.value = ''
    try {
      const parsed = await readBoard(path)
      currentFile.value = path
      board.value = parsed
      theShell().Detail.show(KANBAN_DETAIL_ID)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** 静默重读当前仪表板（Agent 写盘后自刷新；失败保留旧内容不惊扰用户） */
  async function reload(): Promise<void> {
    const path = currentFile.value
    if (!path) return
    try {
      const parsed = await readBoard(path)
      board.value = parsed
      error.value = ''
    } catch {
      // 静默：已呈现的旧内容保留；从未成功打开过才有 error 态
      if (!board.value) error.value = '仪表板自动刷新失败'
    }
  }

  /** 清单标题缓存：path → { modTime, title }（mod_time 未变直接复用，避免高频事件全量重读文件） */
  const titleCache = new Map<string, { modTime: string; title: string }>()

  /** 刷新当前工作区仪表板清单（目录不存在等一律静默置空；标题取 <board name>，回退文件名） */
  async function refreshList(): Promise<void> {
    const dir = kanbansDir.value
    if (!dir) {
      boardList.value = []
      return
    }
    try {
      const entries = await daemon.call<FsEntry[]>('fs.list', { path: dir })
      const files = entries.filter((e) => !e.is_dir && e.name.toLowerCase().endsWith('.dash'))
      boardList.value = await Promise.all(
        files.map(async (e) => {
          const fallback = e.name.replace(/\.dash$/i, '')
          const cached = titleCache.get(e.path)
          if (cached && cached.modTime === e.mod_time) {
            return { path: e.path, name: fallback, title: cached.title }
          }
          let title = fallback
          try {
            const r = await daemon.call<{ content: string }>('fs.read_base64', { path: e.path })
            title = peekBoardTitle(decodeBase64Utf8(r.content)) || fallback
          } catch {
            // 读失败回退文件名（Agent 可能正在写盘中）
          }
          titleCache.set(e.path, { modTime: e.mod_time, title })
          return { path: e.path, name: fallback, title }
        }),
      )
    } catch {
      boardList.value = []
    }
  }

  // ── 刷新通道：Agent 工具执行结束 / 回合结束 → 400ms trailing 合并刷新 ──────
  // envelope 不带文件路径，不做路径过滤；reload/refreshList 均幂等只读。

  let reloadTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleReload(): void {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void reload()
      void refreshList()
    }, RELOAD_DEBOUNCE_MS)
  }

  daemon.onNotification('tool_exec_end', () => scheduleReload())
  daemon.onNotification('loop_end', () => scheduleReload())

  // 工作目录变化 / daemon 重连 → 重拉清单（isConnected 复用 chatflow 连接态）
  watch(
    [kanbansDir, () => chatflow?.store.isConnected ?? false],
    () => {
      void refreshList()
    },
    { immediate: true },
  )

  return {
    currentFile,
    board,
    loading,
    error,
    boardList,
    open,
    reload,
    refreshList,
  }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type KanbanStore = ReturnType<typeof useKanbanStore>

export interface KanbanService {
  readonly store: KanbanStore
}

export function createKanbanService(): KanbanService {
  return {
    get store() {
      return useKanbanStore()
    },
  }
}
