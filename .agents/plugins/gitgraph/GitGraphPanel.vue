<script setup lang="ts">
/**
 * Detail「Git 图」tab：提交拓扑图 + 提交列表（分页滚动加载 + 行内展开详情）。
 * 数据经 store（pty 桥只读 git 命令）；拓扑连线为布局纯函数的按行派生
 * （buildRowGraphics），每行自带小 SVG，滚动追加新行不触碰旧行 DOM。
 * hover 提亮同一 lane 的连线与节点（同 lane 提亮口径，非完整路径追踪）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useGitGraphStore } from './store'
import { buildRowGraphics, laneColor, laneX, ROW_H, type RowSeg } from './engine/graphLayout'
import {
  baseName,
  buildFileGroups,
  clipDiffLines,
  dirOf,
  parseUnifiedDiff,
  type FileGroup,
} from './engine/fileTree'
import type { FileDiff, FileEntry, GitCommit, GitRef, GraphRow } from './types'

const store = useGitGraphStore()

/** 节点纵坐标（行内顶部 52px 区域居中；展开行不随行高变） */
const cy = ROW_H / 2

/** 展开行实测高度（hash → px；仅展开行非 ROW_H，收起即删表项回退常量） */
const heightMap = ref<Map<string, number>>(new Map())

/** 行真高：heightMap 命中取实测值，否则恒 ROW_H（布局函数按此切段） */
function heightOf(hash: string): number {
  return heightMap.value.get(hash) ?? ROW_H
}

/** 每行连线段（布局数据或展开行高度变化时重算；仅展开行高非 52，重算量 O(边数)） */
const graphics = computed(() => buildRowGraphics(store.layout, heightOf))

/** graph 列宽：按实际 lane 数实算，禁拍脑袋固定宽——单 lane 主干仓若给 64px
 * 会让节点右侧出现大条死空白。28px 下限保证单 lane 时节点右侧约 9px 呼吸空间 */
const graphWidth = computed(() =>
  Math.max(28, laneX(Math.max(0, store.layout.laneCount - 1)) + 14),
)

function segsOf(row: GraphRow): RowSeg[] {
  return graphics.value.get(row.commit.hash) ?? []
}

// ── hover 同 lane 提亮 ───────────────────────────────────────────────────────

const hoverLane = ref(-1)

function isDim(lane: number): boolean {
  return hoverLane.value >= 0 && hoverLane.value !== lane
}

/** HEAD 所在分支的 tip 节点（描边高亮） */
function isHeadTip(row: GraphRow): boolean {
  return row.commit.refs.some((r) => r.kind === 'head')
}

// ── 徽章与文案 ───────────────────────────────────────────────────────────────

function refTone(ref: GitRef): 'info' | 'neutral' | 'quiet' {
  if (ref.kind === 'tag') return 'quiet'
  if (ref.kind === 'remote') return 'neutral'
  return 'info'
}

/** 相对时间（列表行） */
function formatRelative(time: number): string {
  if (!time) return ''
  const delta = Math.max(0, Date.now() / 1000 - time)
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 7 * 86400) return `${Math.floor(delta / 86400)} 天前`
  const d = new Date(time * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 全量时间（展开详情） */
function formatFull(time: number): string {
  if (!time) return ''
  return new Date(time * 1000).toLocaleString()
}

/** 完整 message：主题 + 正文 */
function fullMessage(commit: GitCommit): string {
  return commit.body ? `${commit.subject}\n${commit.body}` : commit.subject
}

// ── 提交文件树（GitLens 同构一级目录分组，展开时懒加载）──────────────────────

const expandedFiles = computed<FileEntry[] | undefined>(() =>
  store.expandedHash ? store.filesByHash.get(store.expandedHash) : undefined,
)
const expandedFilesError = computed(() =>
  store.expandedHash ? (store.filesError.get(store.expandedHash) ?? '') : '',
)
const expandedFilesLoading = computed(() =>
  store.expandedHash ? store.loadingFiles.has(store.expandedHash) : false,
)
/** 目录分组（仅文件数据变化时重算） */
const expandedGroups = computed<FileGroup[]>(() => buildFileGroups(expandedFiles.value ?? []))

/** 目录折叠状态（key = hash:dir，跨提交互不影响；默认展开） */
const collapsedDirs = ref<Set<string>>(new Set())
const dirKey = (dir: string): string => `${store.expandedHash}:${dir}`
const isCollapsed = (dir: string): boolean => collapsedDirs.value.has(dirKey(dir))

function toggleDir(dir: string): void {
  const next = new Set(collapsedDirs.value)
  if (next.has(dirKey(dir))) next.delete(dirKey(dir))
  else next.add(dirKey(dir))
  collapsedDirs.value = next
}

/** 状态字母徽章语义色（M 中性 / A 新增绿 / D 删除红 / R·C 变名蓝） */
function statusTone(status: FileEntry['status']): string {
  if (status === 'A') return 'add'
  if (status === 'D') return 'del'
  if (status === 'R' || status === 'C') return 'ren'
  return 'mod'
}

/** 文件行主文本：R/C 展示重命名关系（old → new），其余为文件名 */
function fileLabel(entry: FileEntry): string {
  if (entry.oldPath) return `${baseName(entry.oldPath)} → ${baseName(entry.path)}`
  return baseName(entry.path)
}

/** 文件行弱化 caption：R/C 跨目录时标注目录迁移（所在子目录信息） */
function fileCaption(entry: FileEntry): string {
  if (!entry.oldPath) return ''
  const from = dirOf(entry.oldPath)
  const to = dirOf(entry.path)
  return from === to ? '' : `${from || '（根）'} → ${to || '（根）'}`
}

// ── 内嵌 diff 视图（轻量 unified 渲染，着色对齐 diffview token 用法）────────

/** 激活键反查目标（hash 固定 40 位取前段，路径可含冒号不受影响） */
const activeDiffTarget = computed<{ commit: GitCommit; entry: FileEntry } | null>(() => {
  if (!store.activeDiffKey) return null
  const commit = store.commits.find((c) => c.hash === store.activeDiffKey.slice(0, 40))
  const entry = commit
    ? (store.filesByHash.get(commit.hash) ?? []).find((f) => f.path === store.activeDiffKey.slice(41))
    : undefined
  return commit && entry ? { commit, entry } : null
})

const activeDiff = computed<FileDiff | null>(() =>
  store.activeDiffKey ? (store.diffByKey.get(store.activeDiffKey) ?? null) : null,
)
const activeDiffLoading = computed(() =>
  store.activeDiffKey !== '' && store.diffLoadingKey === store.activeDiffKey,
)
const diffErrorVisible = computed(() => store.diffError !== '')

/** diff 行分类 + 渲染截断（DOM 保护：2MB 文本可达数万行） */
const activeDiffLines = computed(() => {
  const diff = activeDiff.value
  if (!diff) return { visible: [], omitted: 0, empty: false }
  const lines = parseUnifiedDiff(diff.text)
  if (lines.length === 0 && !diff.truncated) return { visible: [], omitted: 0, empty: true }
  return { ...clipDiffLines(lines), empty: false }
})

// ── 滚动触底加载 ─────────────────────────────────────────────────────────────

const listEl = ref<HTMLElement | null>(null)

function onScroll(): void {
  const el = listEl.value
  if (!el || store.busy || !store.hasMore) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) void store.loadMore()
}

// ── 父提交定位跳转 ───────────────────────────────────────────────────────────

const flashHash = ref('')
let flashTimer = 0

function goTo(hash: string): void {
  const el = listEl.value?.querySelector<HTMLElement>(`[data-hash="${hash}"]`)
  if (!el) {
    ElMessage.info('父提交不在已加载范围内')
    return
  }
  el.scrollIntoView({ block: 'center' })
  flashHash.value = hash
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    flashHash.value = ''
  }, 1200)
}

// ── 展开行真高测量（全高连线层的行高数据源）─────────────────────────────────

/** 单实例 ResizeObserver：仅 observe 当前展开行的 .item，内容回流（文件树
 *  懒加载、目录折叠、窗口宽度变化）自动回写实高，graphics 依赖链随之重算 */
const itemObserver = new ResizeObserver((entries) => {
  const entry = entries[0]
  const el = entry?.target as HTMLElement | undefined
  const hash = el?.dataset.hash
  if (!entry || !el || !hash) return
  // contentRect 高 = content box（.item 无 padding），与绝对定位层坐标一致
  heightMap.value = new Map(heightMap.value).set(hash, Math.round(entry.contentRect.height))
})

// 展开行切换：上一行立即删表项回退 ROW_H；新展开行待 DOM 渲染后挂观察
watch(
  () => store.expandedHash,
  (hash, prev) => {
    itemObserver.disconnect()
    if (prev) {
      const next = new Map(heightMap.value)
      next.delete(prev)
      heightMap.value = next
    }
    if (!hash) return
    void nextTick(() => {
      const el = listEl.value?.querySelector<HTMLElement>(`[data-hash="${hash}"]`)
      if (el) itemObserver.observe(el) // 规范：observe 后立即派发首帧测量
    })
  },
)

// ── 生命周期 ─────────────────────────────────────────────────────────────────

onMounted(() => {
  void store.load()
})

onUnmounted(() => {
  window.clearTimeout(flashTimer)
  itemObserver.disconnect()
})

// 工作目录切换（chatflow 服务响应式跟随已在 store 内 watch projectDir 重载）
watch(
  () => store.projectDir,
  () => {
    hoverLane.value = -1
  },
)
</script>

<template>
  <div :class="$style.panel">
    <!-- 顶部工具行：范围切换 + 刷新 + 条数 -->
    <div :class="$style.tools">
      <div :class="$style.range" role="group" aria-label="提交范围">
        <button
          type="button"
          :class="$style.rangeBtn"
          :aria-pressed="store.range === 'current'"
          @click="store.setRange('current')"
        >
          当前分支
        </button>
        <button
          type="button"
          :class="$style.rangeBtn"
          :aria-pressed="store.range === 'all'"
          @click="store.setRange('all')"
        >
          全部分支
        </button>
      </div>
      <button type="button" class="mx-icon-btn" aria-label="刷新" :disabled="store.busy" @click="store.refresh()">
        <MxIcon name="lucide:refresh-cw" :size="16" />
      </button>
      <span :class="$style.count">
        已加载 {{ store.commits.length }} 条<template v-if="store.currentBranch"> · {{ store.currentBranch }}</template>
      </span>
    </div>

    <!-- 主列表：graph 列 + 提交行 -->
    <div ref="listEl" :class="$style.list" @scroll.passive="onScroll">
      <div v-if="store.status === 'loading'" :class="$style.center">正在读取提交记录…</div>
      <div v-else-if="store.status === 'unsupported'" :class="$style.center">
        需要桌面端环境才能读取 Git 记录
      </div>
      <div v-else-if="store.notRepo" :class="$style.center">
        <p :class="$style.centerTitle">当前目录不是 Git 仓库</p>
        <p :class="$style.centerHint">在任务对话中选择一个 Git 项目目录后重试</p>
      </div>
      <div v-else-if="store.status === 'error'" :class="$style.center">
        <p :class="$style.centerTitle">{{ store.errorMsg || '读取 Git 数据失败' }}</p>
        <button type="button" class="mx-btn" @click="store.refresh()">重试</button>
      </div>
      <div v-else-if="store.layout.rows.length === 0" :class="$style.center">没有提交记录</div>
      <template v-else>
        <div
          v-for="row in store.layout.rows"
          :key="row.commit.hash"
          :class="$style.item"
          :data-hash="row.commit.hash"
          :data-flash="flashHash === row.commit.hash ? 'on' : 'off'"
        >
          <div
            :class="$style.row"
            role="button"
            tabindex="0"
            :aria-expanded="store.expandedHash === row.commit.hash"
            @click="store.toggleExpand(row.commit.hash)"
            @keydown.enter.prevent="store.toggleExpand(row.commit.hash)"
            @mouseenter="hoverLane = row.lane"
            @mouseleave="hoverLane = -1"
          >
            <!-- graph 列等宽占位：连线层已提升为 .item 全高覆盖（见 .row 闭合后），此处仅撑位防文本侵占 -->
            <div :class="$style.graphSlot" :style="{ width: `${graphWidth}px` }" aria-hidden="true" />
            <div :class="$style.main">
              <div :class="$style.line1">
                <span :class="$style.subject">{{ row.commit.subject }}</span>
                <span
                  v-for="(ref, ri) in row.commit.refs"
                  :key="`ref-${ri}`"
                  class="mx-tag"
                  :data-tone="refTone(ref)"
                >{{ ref.name }}</span>
              </div>
              <div :class="$style.line2">
                <span :class="$style.mono">{{ row.commit.short }}</span>
                <span>{{ row.commit.author }}</span>
                <span>{{ formatRelative(row.commit.time) }}</span>
              </div>
            </div>
            <MxIcon
              :name="store.expandedHash === row.commit.hash ? 'lucide:chevron-down' : 'lucide:chevron-right'"
              :size="16"
              :class="$style.chev"
            />
          </div>
          <!-- 全高连线层：绝对定位于 .item，覆盖展开区区间，行间角到角拼接不断线 -->
          <svg
            :class="$style.graphLayer"
            :width="graphWidth"
            :height="heightOf(row.commit.hash)"
            aria-hidden="true"
          >
            <path
              v-for="(seg, si) in segsOf(row)"
              :key="`seg-${si}`"
              :d="seg.d"
              fill="none"
              :stroke="laneColor(seg.lane)"
              stroke-width="2"
              stroke-linecap="round"
              :class="{ [$style.faded]: isDim(seg.lane) }"
            />
            <circle
              v-if="isHeadTip(row)"
              :cx="laneX(row.lane)"
              :cy="cy"
              r="7"
              fill="none"
              stroke="var(--mx-accent)"
              stroke-width="1.5"
              :class="{ [$style.faded]: isDim(row.lane) }"
            />
            <circle
              :cx="laneX(row.lane)"
              :cy="cy"
              r="4.5"
              :fill="laneColor(row.lane)"
              :class="{ [$style.faded]: isDim(row.lane) }"
            />
          </svg>
          <!-- 行内展开详情：完整 message / 作者邮箱 / 全量时间 / 父提交定位 / 文件树 -->
          <div v-if="store.expandedHash === row.commit.hash" :class="$style.detail">
            <div :class="$style.fullMsg">{{ fullMessage(row.commit) }}</div>
            <div :class="$style.meta">作者：{{ row.commit.author }}（{{ row.commit.email }}） · {{ formatFull(row.commit.time) }}</div>
            <div v-if="row.commit.parents.length > 0" :class="$style.meta">
              <span>父提交：</span>
              <button
                v-for="parent in row.commit.parents"
                :key="parent"
                type="button"
                class="mx-tag"
                data-tone="quiet"
                @click.stop="goTo(parent)"
              >{{ parent.slice(0, 7) }}</button>
            </div>
            <!-- 文件列表：展开时懒加载，目录分组为可折叠树（根目录文件平铺） -->
            <div :class="$style.files">
              <div v-if="expandedFilesLoading" :class="$style.note">正在加载文件列表…</div>
              <template v-else-if="expandedFilesError">
                <div :class="$style.note">{{ expandedFilesError }}</div>
                <button
                  type="button"
                  class="mx-btn"
                  @click.stop="store.retryCommitFiles(row.commit.hash)"
                >重试</button>
              </template>
              <div v-else-if="expandedGroups.length === 0" :class="$style.note">没有文件变更</div>
              <template v-else>
                <div v-for="group in expandedGroups" :key="group.dir || '/'">
                  <button
                    v-if="group.dir"
                    type="button"
                    :class="[$style.treeRow, $style.dirRow]"
                    :aria-expanded="!isCollapsed(group.dir)"
                    @click.stop="toggleDir(group.dir)"
                  >
                    <MxIcon :name="isCollapsed(group.dir) ? 'lucide:folder' : 'lucide:folder-open'" :size="16" />
                    <span :class="$style.dirName">{{ group.dir }}/</span>
                    <span :class="$style.dirCount">{{ group.files.length }}</span>
                  </button>
                  <template v-if="!group.dir || !isCollapsed(group.dir)">
                    <button
                      v-for="entry in group.files"
                      :key="entry.path"
                      type="button"
                      :class="[$style.treeRow, $style.fileRow]"
                      :data-active="store.activeDiffKey === `${row.commit.hash}:${entry.path}` ? 'on' : 'off'"
                      :title="entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path"
                      @click.stop="store.openFileDiff(row.commit, entry)"
                    >
                      <MxIcon name="lucide:file" :size="16" :class="$style.fileIcon" />
                      <span :class="$style.fileName">{{ fileLabel(entry) }}</span>
                      <span v-if="fileCaption(entry)" :class="$style.fileCaption">{{ fileCaption(entry) }}</span>
                      <span :class="$style.statusBadge" :data-tone="statusTone(entry.status)">{{ entry.status }}</span>
                    </button>
                  </template>
                </div>
              </template>
            </div>
            <!-- 内嵌 diff 视图：点文件行展开（再点收起），渲染风格对齐 diffview -->
            <div
              v-if="activeDiffTarget && activeDiffTarget.commit.hash === row.commit.hash"
              :class="$style.diffBox"
            >
              <div :class="$style.diffHead">
                <span :class="$style.diffTitle">{{ fileLabel(activeDiffTarget.entry) }}</span>
                <span :class="$style.statusBadge" :data-tone="statusTone(activeDiffTarget.entry.status)">{{ activeDiffTarget.entry.status }}</span>
                <span v-if="activeDiff?.truncated" :class="$style.diffTruncated">文件过大，仅显示部分</span>
                <span :class="$style.spacer" />
                <button type="button" class="mx-icon-btn" aria-label="关闭 diff" @click.stop="store.closeDiff()">
                  <MxIcon name="lucide:x" :size="16" />
                </button>
              </div>
              <div v-if="activeDiffLoading" :class="$style.note">正在读取 diff…</div>
              <template v-else-if="diffErrorVisible">
                <div :class="$style.note">{{ store.diffError }}</div>
                <button
                  type="button"
                  class="mx-btn"
                  @click.stop="store.retryDiff(activeDiffTarget.commit, activeDiffTarget.entry)"
                >重试</button>
              </template>
              <div v-else-if="activeDiffLines.empty" :class="$style.note">该文件在此提交中无内容差异</div>
              <template v-else>
                <div :class="$style.diffBody">
                  <div
                    v-for="(ln, i) in activeDiffLines.visible"
                    :key="i"
                    :class="$style.diffLine"
                    :data-kind="ln.kind"
                  >{{ ln.text }}</div>
                </div>
                <div v-if="activeDiffLines.omitted > 0" :class="$style.note">
                  已省略 {{ activeDiffLines.omitted }} 行（渲染上限保护）
                </div>
              </template>
            </div>
          </div>
        </div>
        <!-- 底部状态：加载中 / 已全部 -->
        <div v-if="store.loadingMore" :class="$style.footer">正在加载更多…</div>
        <div v-else-if="!store.hasMore" :class="$style.footer">
          已加载全部 {{ store.commits.length }} 条提交
        </div>
      </template>
    </div>
  </div>
</template>

<style module>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.tools {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-bottom: 1px solid var(--mx-separator-soft);
}

.range {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--mx-module);
  border-radius: var(--mx-radius-control);
}

.rangeBtn {
  border: none;
  background: none;
  padding: var(--mx-space-1) var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  cursor: pointer;
}

.rangeBtn:hover:not([aria-pressed='true']) {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.rangeBtn:active:not([aria-pressed='true']) {
  background: var(--mx-active);
}

.rangeBtn:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.rangeBtn[aria-pressed='true'] {
  background: var(--mx-bg-surface);
  color: var(--mx-text);
}

.count {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: var(--mx-space-4);
}

.center {
  padding: var(--mx-space-7) var(--mx-space-4);
  text-align: center;
  font: var(--mx-font-body);
  color: var(--mx-text-tertiary);
}

.centerTitle {
  margin: 0 0 var(--mx-space-2);
}

.centerHint {
  margin: 0;
  font: var(--mx-font-caption);
}

.item {
  position: relative;
  border-bottom: 1px solid var(--mx-separator-soft);
}

.item[data-flash='on'] {
  background: var(--mx-nav-active);
}

.row {
  /* 锁死与 graphLayout.ROW_H 同步：防文本换行撑高破坏非展开行的段坐标假设 */
  height: 52px;
  display: flex;
  align-items: stretch;
  gap: var(--mx-space-2);
  padding: 0 var(--mx-space-3);
  cursor: pointer;
}

.row:hover {
  background: var(--mx-hover);
}

.row:active {
  background: var(--mx-active);
}

.row:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: -2px;
}

/* graph 列等宽占位（.row 内撑位） */
.graphSlot {
  flex: none;
}

/* 全高连线层：覆盖整个 .item（含展开区），事件穿透给提交行 */
.graphLayer {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  pointer-events: none;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.line1 {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-width: 0;
}

.subject {
  font: var(--mx-font-body);
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 徽章不收缩换行：refs 少量时右排（超宽随 subject 一起被裁） */
.line1 .mx-tag {
  flex: none;
}

.line2 {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}

.mono {
  font-family: var(--mx-font-mono);
}

.chev {
  align-self: center;
  flex: none;
  color: var(--mx-text-tertiary);
}

.detail {
  padding: var(--mx-space-2) var(--mx-space-3) var(--mx-space-3);
  margin-left: var(--mx-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.fullMsg {
  font: var(--mx-font-body);
  color: var(--mx-text);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--mx-space-2);
  font-variant-numeric: tabular-nums;
}

/* ── 提交文件树（GitLens 同构一级目录分组）────────────────────────────────── */

.files {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--mx-space-1) 0 0;
  padding: var(--mx-space-2);
  background: var(--mx-module);
  border-radius: var(--mx-radius-control);
}

.note {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-1) 0;
}

/* 目录行 / 文件行公共底座 */
.treeRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) var(--mx-space-2);
  border: none;
  background: none;
  border-radius: var(--mx-radius-control);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  cursor: pointer;
  text-align: left;
}

.treeRow:hover { background: var(--mx-hover); color: var(--mx-text); }

.treeRow:focus-visible { outline: 2px solid var(--mx-accent); outline-offset: -2px; }

/* 目录行 / 文件行差异与行内徽章（目录名 / 文件名 / diff 标题共用 ellipsis 三件套） */
.dirRow { font-weight: 600; color: var(--mx-text); }
.fileRow { padding-left: var(--mx-space-3); }
.fileIcon { flex: none; color: var(--mx-text-tertiary); }
.dirCount { flex: none; font: var(--mx-font-micro); color: var(--mx-text-tertiary); }
.fileCaption { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--mx-font-micro); color: var(--mx-text-tertiary); }
.statusBadge { flex: none; min-width: 16px; padding: 0 var(--mx-space-1); border-radius: var(--mx-radius-control); font: var(--mx-font-micro); font-family: var(--mx-font-mono); text-align: center; color: var(--mx-text-tertiary); background: color-mix(in srgb, var(--mx-text-tertiary) 10%, transparent); }
.statusBadge[data-tone='add'] { color: var(--mx-success); background: color-mix(in srgb, var(--mx-success) 10%, transparent); }
.statusBadge[data-tone='del'] { color: var(--mx-danger); background: color-mix(in srgb, var(--mx-danger) 10%, transparent); }
.statusBadge[data-tone='ren'] { color: var(--mx-accent); background: color-mix(in srgb, var(--mx-accent) 10%, transparent); }
.dirName,
.fileName,
.diffTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diffTitle { color: var(--mx-text); font-family: var(--mx-font-mono); }

.diffTruncated { flex: none; font-size: var(--mx-font-micro); color: var(--mx-state-warn); }

.spacer { flex: 1; }

.diffBox { margin: var(--mx-space-2) 0 0; border: 1px solid var(--mx-separator); border-radius: var(--mx-radius-control); overflow: hidden; background: var(--mx-module); }
.diffHead { display: flex; align-items: center; gap: var(--mx-space-2); padding: var(--mx-space-1) var(--mx-space-2); border-bottom: 1px solid var(--mx-separator); }

.diffBody {
  max-height: 320px;
  overflow: auto;
  padding: var(--mx-space-2) 0;
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  line-height: 1.6;
}

.diffLine {
  padding: 0 var(--mx-space-2);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--mx-text-secondary);
}

.diffLine[data-kind='add'] {
  color: var(--mx-success);
  background: color-mix(in srgb, var(--mx-success) 10%, transparent);
}

.diffLine[data-kind='del'] {
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
}

.diffLine[data-kind='hunk'] {
  color: var(--mx-text-tertiary);
  background: color-mix(in srgb, var(--mx-text-tertiary) 10%, transparent);
}

.diffLine[data-kind='meta'] {
  color: var(--mx-accent);
  opacity: 0.9;
}

.footer {
  padding: var(--mx-space-3) 0;
  text-align: center;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* hover 提亮同 lane 时，其余 lane 的连线与节点降透明（过渡保平滑） */
.faded { opacity: 0.25; transition: opacity 0.15s ease; }
</style>
