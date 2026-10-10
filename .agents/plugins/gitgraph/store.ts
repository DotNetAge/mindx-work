/**
 * gitgraph 插件 store：Git 提交数据状态与分页加载（Pinia setup 风格，对齐
 * video-editor/store.ts 范式：壳引用装配期捕获、store 顶部零 inject 依赖）。
 * 数据通道：Electron 宿主 pty 桥跑只读 git 命令（engine/gitSource，通道实证见其头注）；
 * 工作目录取 chatflow 当前目录，空则回退 fs.home（范式同 video-editor/ImportBrowser.vue）。
 * 布局为纯函数派生（computed），仅在提交数据变化时重算一次。
 */

import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'
import {
  detectRepo,
  fetchCommitFiles,
  fetchCommits,
  fetchCurrentBranch,
  fetchFileDiff,
  GitShellSession,
  resolvePtyBridge,
} from './engine/gitSource'
import { layoutGraph } from './engine/graphLayout'
import type { FileDiff, FileEntry, GitCommit, GraphLayout } from './types'

/** Detail tab 条目 id（index.ts 注册与 Toolbar 入口跳转共用） */
export const GITGRAPH_DETAIL_ID = 'gitgraph-detail'

/** 分页参数：每页 200，加载上限 2000 */
const PAGE_SIZE = 200
const MAX_COMMITS = 2000

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindGitgraphShell(shell: VueAppShell): void {
  shellRef = shell
}

function theShell(): VueAppShell {
  if (!shellRef) throw new Error('gitgraph 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明 ───────────────────────────────────────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown): Promise<T>
}

interface ChatflowServiceLike {
  store: { currentProjectDir?: string }
}

export const useGitGraphStore = defineStore('gitgraph-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')
  // chatflow 可停用（服务不存在），拿不到走 fs.home 兜底
  let chatflow: ChatflowServiceLike | null = null
  try {
    chatflow = theShell().services.use<ChatflowServiceLike>('chatflow.store')
  } catch {
    chatflow = null
  }

  // ── 状态 ───────────────────────────────────────────────────────────────────
  /** idle = 尚未首载；loading = 首载中；ready = 数据就绪（含空态）；unsupported = 无宿主桥；error = 失败 */
  const status = ref<'idle' | 'loading' | 'ready' | 'unsupported' | 'error'>('idle')
  /** 当前目录不是 Git 仓库（可读空态，区别于错误） */
  const notRepo = ref(false)
  const errorMsg = ref('')
  const commits = ref<GitCommit[]>([])
  /** 提交范围：当前分支 / 全部分支 */
  const range = ref<'current' | 'all'>('current')
  /** HEAD 分支名（游离 HEAD 为空串） */
  const currentBranch = ref('')
  /** 是否还有更多页（页未满 / 到上限 / 分页失败后为 false） */
  const hasMore = ref(true)
  const loadingMore = ref(false)
  /** 行内展开详情的提交 hash（空串 = 全部收起） */
  const expandedHash = ref('')
  /** 提交文件列表缓存（展开时懒加载，按提交缓存；hash 内容寻址，刷新后仍有效） */
  const filesByHash = ref<Map<string, FileEntry[]>>(new Map())
  /** 文件列表加载失败信息（hash → 可读错误；重试成功即删除） */
  const filesError = ref<Map<string, string>>(new Map())
  /** 文件列表加载中集合（防止重复请求） */
  const loadingFiles = ref<Set<string>>(new Set())
  /** 当前展示 diff 的缓存键（`${hash}:${path}`，空串 = 无） */
  const activeDiffKey = ref('')
  /** 单文件 diff 文本缓存（同键复用；内容寻址安全） */
  const diffByKey = ref<Map<string, FileDiff>>(new Map())
  /** diff 加载中的键 */
  const diffLoadingKey = ref('')
  /** diff 加载失败信息（仅当前激活键可读） */
  const diffError = ref('')
  /** 当前工作目录（响应式：chatflow 目录切换时面板重载跟随） */
  const projectDir = ref(chatflow?.store.currentProjectDir || '')

  // ── 派生（仅数据变化时重算一次）───────────────────────────────────────────
  const layout = computed<GraphLayout>(() => layoutGraph(commits.value))
  const busy = computed(() => status.value === 'loading' || loadingMore.value)

  // ── 内部工具 ───────────────────────────────────────────────────────────────

  /** 工作目录解析：chatflow 当前目录优先，空则回退主目录（范式同 ImportBrowser） */
  async function resolveCwd(): Promise<string> {
    if (projectDir.value) return projectDir.value
    try {
      const home = await daemon.call<{ path: string }>('fs.home', {})
      return home?.path || ''
    } catch {
      return ''
    }
  }

  async function closeQuietly(session: GitShellSession | null): Promise<void> {
    try {
      await session?.close()
    } catch {
      // 会话已死无需清理
    }
  }

  /** 标记「当前目录不是 Git 仓库」空态（load 与 detectRepo 两处共用） */
  function markNotRepo(): void {
    notRepo.value = true
    commits.value = []
    currentBranch.value = ''
    hasMore.value = false
    status.value = 'ready'
  }

  /** 空仓库（init 后无提交）：就绪空态，非错误 */
  function markEmptyRepo(): void {
    commits.value = []
    hasMore.value = false
    status.value = 'ready'
  }

  // ── 数据加载 ───────────────────────────────────────────────────────────────

  /** 首载 / 刷新代数：目录切换、范围切换、手动刷新并发时旧结果按代丢弃 */
  let loadGen = 0
  /** 存活 pty 会话集合（load/loadMore/文件列表/diff 可并发各占一会话，dispose 全关） */
  const pendingSessions = new Set<GitShellSession>()

  function trackSession(session: GitShellSession): void {
    pendingSessions.add(session)
  }

  function untrackSession(session: GitShellSession | null): void {
    if (session) pendingSessions.delete(session)
    void closeQuietly(session)
  }

  /** 重置文件列表 / diff 相关状态（首载与目录切换时清旧仓库数据） */
  function resetFileState(): void {
    filesByHash.value = new Map()
    filesError.value = new Map()
    loadingFiles.value = new Set()
    activeDiffKey.value = ''
    diffByKey.value = new Map()
    diffLoadingKey.value = ''
    diffError.value = ''
  }

  async function load(): Promise<void> {
    if (!resolvePtyBridge()) {
      status.value = 'unsupported'
      return
    }
    const gen = ++loadGen
    status.value = 'loading'
    notRepo.value = false
    errorMsg.value = ''
    expandedHash.value = ''
    resetFileState()
    let session: GitShellSession | null = null
    try {
      const cwd = await resolveCwd()
      if (gen !== loadGen) return
      if (!cwd) {
        status.value = 'error'
        errorMsg.value = '未确定工作目录，请先在任务对话中选择工作区'
        return
      }
      const bridge = resolvePtyBridge()
      if (!bridge) {
        status.value = 'unsupported'
        return
      }
      session = await GitShellSession.open(bridge, cwd)
      trackSession(session)
      if (gen !== loadGen) return
      const inside = await detectRepo(session)
      if (gen !== loadGen) return
      if (!inside) {
        markNotRepo()
        return
      }
      currentBranch.value = await fetchCurrentBranch(session)
      if (gen !== loadGen) return
      const page = await fetchCommits(session, { limit: PAGE_SIZE, skip: 0, all: range.value === 'all' })
      if (gen !== loadGen) return
      commits.value = page
      hasMore.value = page.length >= PAGE_SIZE && page.length < MAX_COMMITS
      status.value = 'ready'
    } catch (e) {
      if (gen !== loadGen) return
      const message = e instanceof Error ? e.message : String(e)
      if (message === '当前目录不是 Git 仓库') {
        markNotRepo()
        return
      }
      if (message === '仓库还没有任何提交') {
        markEmptyRepo()
        return
      }
      status.value = 'error'
      errorMsg.value = message || '读取 Git 数据失败'
    } finally {
      untrackSession(session)
    }
  }

  /** 触底分页：另开会话取下一页（旧页 lane 布局不回变，见 graphLayout 头注） */
  async function loadMore(): Promise<void> {
    if (loadingMore.value || !hasMore.value || commits.value.length >= MAX_COMMITS) return
    const bridge = resolvePtyBridge()
    if (!bridge) return
    const gen = loadGen
    loadingMore.value = true
    let session: GitShellSession | null = null
    try {
      const cwd = await resolveCwd()
      if (!cwd || gen !== loadGen) return
      session = await GitShellSession.open(bridge, cwd)
      trackSession(session)
      if (gen !== loadGen) return
      const page = await fetchCommits(session, {
        limit: PAGE_SIZE,
        skip: commits.value.length,
        all: range.value === 'all',
      })
      if (gen !== loadGen) return
      // 追加去重（刷新间隙引用变化时同一提交可能跨页出现）
      const seen = new Set(commits.value.map((c) => c.hash))
      const fresh = page.filter((c) => !seen.has(c.hash))
      commits.value = [...commits.value, ...fresh]
      hasMore.value = page.length >= PAGE_SIZE && commits.value.length < MAX_COMMITS
    } catch {
      // 分页失败不打断已有内容：提示后停在当前页，刷新可重来
      hasMore.value = false
      errorMsg.value = ''
    } finally {
      untrackSession(session)
      loadingMore.value = false
    }
  }

  // ── 动作 ───────────────────────────────────────────────────────────────────

  function refresh(): void {
    void load()
  }

  function setRange(next: 'current' | 'all'): void {
    if (range.value === next) return
    range.value = next
    void load()
  }

  /** 展开提交时懒加载文件列表（缓存命中跳过；失败可重试） */
  async function loadCommitFiles(commit: GitCommit): Promise<void> {
    const hash = commit.hash
    if (filesByHash.value.has(hash) || loadingFiles.value.has(hash)) return
    const bridge = resolvePtyBridge()
    if (!bridge) return
    loadingFiles.value = new Set(loadingFiles.value).add(hash)
    filesError.value.delete(hash)
    let session: GitShellSession | null = null
    try {
      const cwd = await resolveCwd()
      if (!cwd) throw new Error('未确定工作目录')
      session = await GitShellSession.open(bridge, cwd)
      trackSession(session)
      filesByHash.value.set(hash, await fetchCommitFiles(session, hash, commit.parents.length === 0))
    } catch (e) {
      filesError.value.set(hash, e instanceof Error ? e.message : String(e))
    } finally {
      untrackSession(session)
      const next = new Set(loadingFiles.value)
      next.delete(hash)
      loadingFiles.value = next
    }
  }

  function toggleExpand(hash: string): void {
    expandedHash.value = expandedHash.value === hash ? '' : hash
    if (!expandedHash.value) {
      // 收起时同步收起 diff 视图（缓存保留，再展开免重取）
      activeDiffKey.value = ''
      return
    }
    const commit = commits.value.find((c) => c.hash === hash)
    if (commit) void loadCommitFiles(commit)
  }

  /** 文件列表加载重试（清失败标记后重走加载） */
  function retryCommitFiles(hash: string): void {
    filesError.value.delete(hash)
    const commit = commits.value.find((c) => c.hash === hash)
    if (commit) void loadCommitFiles(commit)
  }

  /** diff 缓存键（hash + 新路径即可定位，同一提交内路径唯一） */
  function diffKeyOf(hash: string, path: string): string {
    return `${hash}:${path}`
  }

  /**
   * 点文件行打开 diff：已激活再点收起；命中缓存直接展示，否则经 pty 取
   * （R/C 双路径过滤保 rename 配对，见 fetchFileDiff 头注）。
   */
  async function openFileDiff(commit: GitCommit, entry: FileEntry): Promise<void> {
    const key = diffKeyOf(commit.hash, entry.path)
    if (activeDiffKey.value === key) {
      closeDiff()
      return
    }
    activeDiffKey.value = key
    diffError.value = ''
    if (diffByKey.value.has(key) || diffLoadingKey.value === key) return
    const bridge = resolvePtyBridge()
    if (!bridge) {
      diffError.value = '需要桌面端环境才能读取 diff'
      return
    }
    diffLoadingKey.value = key
    let session: GitShellSession | null = null
    try {
      const cwd = await resolveCwd()
      if (!cwd) throw new Error('未确定工作目录')
      session = await GitShellSession.open(bridge, cwd)
      trackSession(session)
      const diff = await fetchFileDiff(session, {
        hash: commit.hash,
        parent: commit.parents[0],
        paths: entry.oldPath ? [entry.oldPath, entry.path] : [entry.path],
        isRoot: commit.parents.length === 0,
      })
      if (activeDiffKey.value !== key) return // 期间用户切换了目标，结果仍入缓存备用
      diffByKey.value.set(key, diff)
    } catch (e) {
      if (activeDiffKey.value === key) diffError.value = e instanceof Error ? e.message : String(e)
    } finally {
      untrackSession(session)
      if (diffLoadingKey.value === key) diffLoadingKey.value = ''
    }
  }

  /** 收起 diff 视图（展开提交行时由 toggleExpand 联动） */
  function closeDiff(): void {
    activeDiffKey.value = ''
    diffError.value = ''
  }

  /** 当前激活 diff 的重试（清缓存键后重取） */
  function retryDiff(commit: GitCommit, entry: FileEntry): void {
    diffError.value = ''
    diffByKey.value.delete(diffKeyOf(commit.hash, entry.path))
    void openFileDiff(commit, entry)
  }

  /** 插件停用清理（index.ts cleanup 调）：关闭全部尚存活的 pty 会话 */
  function dispose(): void {
    const sessions = [...pendingSessions]
    pendingSessions.clear()
    for (const session of sessions) void closeQuietly(session)
  }

  // chatflow 工作目录切换跟随（服务响应式形状；store 未实例化时不订阅）
  watch(
    () => chatflow?.store.currentProjectDir,
    (dir) => {
      if (dir && dir !== projectDir.value) projectDir.value = dir
    },
  )
  watch(projectDir, () => {
    // 目录变化即重载（面板挂载期 store 已实例化；未开 tab 时 store 尚未创建不触发）
    if (status.value !== 'idle') void load()
  })

  return {
    status,
    notRepo,
    errorMsg,
    commits,
    range,
    currentBranch,
    hasMore,
    loadingMore,
    expandedHash,
    filesByHash,
    filesError,
    loadingFiles,
    activeDiffKey,
    diffByKey,
    diffLoadingKey,
    diffError,
    projectDir,
    layout,
    busy,
    load,
    loadMore,
    refresh,
    setRange,
    toggleExpand,
    retryCommitFiles,
    openFileDiff,
    closeDiff,
    retryDiff,
    dispose,
  }
})
