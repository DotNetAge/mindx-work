/**
 * explorer 插件 store：懒加载目录树状态 + 命令 action（Model）。
 *
 * 数据通道：daemon fs.* RPC（fs.list / fs.stat / fs.home，参数与返回形状以
 * daemon handler_fs.go 实证为准，禁止猜测）。壳引用经 bindShell 在插件装配期
 * 捕获——store 顶部保持零 inject 依赖，首次实例化可发生在任意运行期时机
 * （Pinia 在 mountVueApp 内才安装，装配期 provide 不得触发 store 创建）。
 *
 * 树模型（Trae 式对齐）：children 按目录路径缓存单层清单（懒加载，展开才列取），
 * expanded 记录展开态；reveal 沿父链逐级展开定位文件（open 命令语义）。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const EXPLORER_DETAIL_ID = 'explorer-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体（机制入口稳定，非响应式） */
export function bindExplorerShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳：bindExplorerShell 必先执行（预置插件装配清单保证） */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('explorer 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明（插件间禁止 import，本地声明所需最小形状）────────────

/** daemon 连接服务（fs RPC 通道） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** fs.list 条目（daemon FSEntry 实证：name/path/size/is_dir/mode/mod_time） */
export interface FsEntry {
  name: string
  path: string
  size: number
  is_dir: boolean
  mod_time: string
}

// ── store ────────────────────────────────────────────────────────────────────

export const useExplorerStore = defineStore('explorer-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 树根目录（当前工作区，绝对路径） */
  const rootDir = ref('')
  /** 已加载目录的子项缓存（key = 目录绝对路径；懒加载，展开才列取） */
  const children = ref<Record<string, FsEntry[]>>({})
  /** 目录展开态（key = 目录绝对路径） */
  const expanded = ref<Record<string, boolean>>({})
  /** 列取中的目录（行内 loading 呈现） */
  const loadingDirs = ref<Record<string, boolean>>({})
  /** 定位高亮文件（open 命令 reveal 后选中呈现） */
  const highlightPath = ref('')
  /** open 跨树定位钉住标记（true = 树根由 open 显式迁根，工作区初始化不得覆盖） */
  const pinnedByOpen = ref(false)
  /** 树名称过滤（前端过滤已加载链；空串 = 不过滤） */
  const filter = ref('')
  const error = ref('')

  /** 列取目录（已缓存直接返回；失败写 error 返回空数组） */
  async function listDir(dir: string): Promise<FsEntry[]> {
    const cached = children.value[dir]
    if (cached) return cached
    loadingDirs.value = { ...loadingDirs.value, [dir]: true }
    try {
      const list = await daemon.call<FsEntry[]>('fs.list', { path: dir })
      children.value = { ...children.value, [dir]: list }
      return list
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return []
    } finally {
      const next = { ...loadingDirs.value }
      delete next[dir]
      loadingDirs.value = next
    }
  }

  /** 展开/收起目录（首次展开懒加载；加载失败不置展开态） */
  async function toggle(dir: string): Promise<void> {
    if (expanded.value[dir]) {
      expanded.value = { ...expanded.value, [dir]: false }
      return
    }
    const list = await listDir(dir)
    if (children.value[dir]) {
      expanded.value = { ...expanded.value, [dir]: true }
      void list
    }
  }

  /** 剥离 grep 命中行传入的 `:行号`（或 `:起-止`）尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /** 父目录（跨平台分隔符；根目录返回空串） */
  function parentDir(p: string): string {
    const seg = p.split('/').filter(Boolean)
    seg.pop()
    return seg.length ? '/' + seg.join('/') : ''
  }

  /**
   * 沿父链逐级展开定位 target（根→目标的祖先目录全部列取并展开）。
   * target 不在当前树根之下时（跨工作区定位）：树根迁移到 target 父目录链。
   */
  async function reveal(path: string): Promise<void> {
    const segs = path.split('/').filter(Boolean)
    // 祖先目录链（绝对路径逐级拼接，rootDir 必为其前缀才在树内）
    const ancestors: string[] = []
    for (let i = 1; i <= segs.length - 1; i++) {
      ancestors.push('/' + segs.slice(0, i).join('/'))
    }
    // 跨树定位：树根不在祖先链内 → 整棵树重置到目标父目录（保持 reveal 语义可达）
    const inTree = !rootDir.value || ancestors.some((a) => a === rootDir.value) || path.startsWith(rootDir.value + '/')
    if (!inTree) {
      const newRoot = parentDir(path) || '/'
      rootDir.value = newRoot
      children.value = {}
      expanded.value = {}
      pinnedByOpen.value = true
      await listDir(newRoot)
      highlightPath.value = path
      return
    }
    // 树内定位：从根逐级展开到目标父目录（子级目录懒加载后置展开态）
    for (const dir of ancestors) {
      if (dir === rootDir.value) {
        await listDir(dir)
        continue
      }
      if (!dir.startsWith(rootDir.value + '/')) continue
      await listDir(dir)
      expanded.value = { ...expanded.value, [dir]: true }
    }
  }

  /**
   * 命令 action（契约 §10.3 范式）：树内定位路径并打开详情轨道。
   * 文件 reveal 父链展开 + 高亮；目录直接展开一级。
   */
  async function open(target: string): Promise<void> {
    const path = stripLineSuffix(target.trim())
    if (!path) return
    const shell = theShell()
    try {
      const st = await daemon.call<{ is_dir: boolean }>('fs.stat', { path })
      highlightPath.value = st.is_dir ? '' : path
      if (st.is_dir) {
        await toggle(path)
      } else {
        await reveal(path)
      }
    } catch {
      // stat 失败（路径不存在/不可访问）：按 reveal 容错定位
      highlightPath.value = ''
      await reveal(path)
    }
    shell.Detail.show(EXPLORER_DETAIL_ID)
  }

  /**
   * 跟随当前会话工作区（DetailPanel 桥接 chatflow.store 的 currentProjectDir）。
   * 根只能是当前工作目录：空值（尚无会话）不回退主目录，呈现待会话空态。
   */
  function setWorkspace(dir: string): void {
    if (dir && dir !== rootDir.value) {
      pinnedByOpen.value = false
      void resetRoot(dir)
    }
  }

  /** 重置树根：清缓存展开态后列取根（工作区切换 / 首次初始化） */
  async function resetRoot(dir: string): Promise<void> {
    rootDir.value = dir
    children.value = {}
    expanded.value = {}
    error.value = ''
    highlightPath.value = ''
    await listDir(dir)
  }

  // ── 右键菜单（Trae 式：新建/重命名/删除/在 Finder 中显示/刷新）────────────
  /** 右键目标 + 菜单位置（null = 关闭） */
  const ctx = ref<{ entry: FsEntry | null; x: number; y: number } | null>(null)
  /** 内联重命名目标路径（null = 非编辑态） */
  const renamingPath = ref('')
  /** 新建 phantom 条目（parent = 目标父目录；dir = 文件夹） */
  const creating = ref<{ parent: string; dir: boolean } | null>(null)

  function openCtx(entry: FsEntry | null, x: number, y: number): void {
    ctx.value = { entry, x, y }
  }

  function closeCtx(): void {
    ctx.value = null
  }

  /** 父目录（右键空白 = 根；条目 = 目录自身 / 文件父目录） */
  function ctxParent(): string {
    const entry = ctx.value?.entry
    if (!entry) return rootDir.value
    return entry.is_dir ? entry.path : parentDir(entry.path)
  }

  /** RPC 通道收敛（daemon.connection 服务形状已在顶部声明） */
  function rpc<T>(method: string, params?: unknown): Promise<T> {
    return daemon.call<T>(method, params)
  }

  /** 新建文件夹（父目录懒加载链已在树中，创建后重列父目录） */
  async function makeDir(parent: string, name: string): Promise<void> {
    await rpc('fs.mkdir', { path: `${parent}/${name}` })
    await refreshDir(parent)
  }

  /** 新建空文件（fs.write 空内容；已存在文件会被覆盖——创建前先查重） */
  async function makeFile(parent: string, name: string): Promise<void> {
    const path = `${parent}/${name}`
    let exists = false
    try {
      await rpc('fs.stat', { path })
      exists = true
    } catch {
      exists = false
    }
    if (exists) throw new Error('同名文件已存在')
    await rpc('fs.write', { path, content: '' })
    await refreshDir(parent)
  }

  /** 重命名（fs.mv 同目录移动；目录改名后其子树缓存路径全部失效，一并清理） */
  async function rename(src: string, nextName: string): Promise<void> {
    const parent = parentDir(src)
    const dst = `${parent}/${nextName}`
    if (dst === src) return
    await rpc('fs.mv', { src, dst })
    // 子树缓存清理：以 src 为路径或路径前缀的 children/expanded 全部失效
    const dropKeys = (record: Record<string, unknown>): Record<string, unknown> => {
      const next: Record<string, unknown> = {}
      for (const key of Object.keys(record)) {
        if (key !== src && !key.startsWith(src + '/')) next[key] = record[key]
      }
      return next
    }
    children.value = dropKeys(children.value) as typeof children.value
    expanded.value = dropKeys(expanded.value) as typeof expanded.value
    if (highlightPath.value === src) highlightPath.value = dst
    await refreshDir(parent)
  }

  /** 删除（目录递归；删除后清子树缓存并重列父目录） */
  async function remove(path: string, isDir: boolean): Promise<void> {
    await rpc('fs.rm', { path, recurse: isDir, force: true })
    const dropKeys = (record: Record<string, unknown>): Record<string, unknown> => {
      const next: Record<string, unknown> = {}
      for (const key of Object.keys(record)) {
        if (key !== path && !key.startsWith(path + '/')) next[key] = record[key]
      }
      return next
    }
    children.value = dropKeys(children.value) as typeof children.value
    expanded.value = dropKeys(expanded.value) as typeof expanded.value
    if (highlightPath.value === path || highlightPath.value.startsWith(path + '/')) {
      highlightPath.value = ''
    }
    await refreshDir(parentDir(path) || rootDir.value)
  }

  /** 在 Finder 中显示（daemon fs.reveal） */
  async function revealInFinder(path: string): Promise<void> {
    await rpc('fs.reveal', { path })
  }

  /** 重列单个目录（children 缓存替换；目录未缓存过则先列取） */
  async function refreshDir(dir: string): Promise<void> {
    if (!dir) return
    const cached = children.value[dir]
    children.value = { ...children.value, [dir]: [] as FsEntry[] }
    try {
      const list = await rpc<FsEntry[]>('fs.list', { path: dir })
      children.value = { ...children.value, [dir]: list }
    } catch (e) {
      if (cached) children.value = { ...children.value, [dir]: cached }
      else delete children.value[dir]
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 刷新：已展开目录全部重列（保留展开态与高亮） */
  async function refresh(): Promise<void> {
    const dirs = [rootDir.value, ...Object.keys(expanded.value).filter((d) => expanded.value[d])]
    children.value = {}
    for (const dir of dirs) {
      if (dir) await listDir(dir)
    }
  }

  return {
    rootDir,
    children,
    expanded,
    loadingDirs,
    highlightPath,
    pinnedByOpen,
    filter,
    error,
    ctx,
    renamingPath,
    creating,
    toggle,
    open,
    refresh,
    setWorkspace,
    openCtx,
    closeCtx,
    ctxParent,
    makeDir,
    makeFile,
    rename,
    remove,
    revealInFinder,
  }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type ExplorerStore = ReturnType<typeof useExplorerStore>

export interface ExplorerService {
  /** store 响应式本体（Pinia 缓存实例，重复解引用同一份） */
  readonly store: ExplorerStore
}

/** 契约 §10：通道里流动的是 Pinia store 响应式本体；首次解引用须在 mount 之后 */
export function createExplorerService(): ExplorerService {
  return {
    get store() {
      return useExplorerStore()
    },
  }
}
