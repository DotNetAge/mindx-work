<script setup lang="ts">
/**
 * DiffPanel —— Detail「变更」tab 主面板：当前会话待确认文件变更的集中审看。
 *
 * 布局（Detail 轨道 240-520 窄宽度，上下结构）：
 *   工具行（计数 + 合计 ± + 确认/回退动作）→ 文件清单（紧凑行，勾选 + hover
 *   单文件动作）→ 选中文件 diff 正文（flex 1 滚动，unified diff 行内着色）。
 *
 * 数据源 = chatflow.store 服务（pendingFileModificationsBySession / 确认回滚
 * 动作），本组件纯 UI：RPC 由 store 动作内聚，失败 toast 由调用方处理。
 * 联动：store.diffFocusPath 非空时选中该文件并清空（对话流跳转定位通道）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MxIcon, useService } from '@mindx-work/ui-shell-vue'

// ── chatflow.store 服务形状（消费侧本地声明，插件间禁止 import）──────────
interface PendingFileMod {
  path: string
  diff: string
  additions: number
  deletions: number
  isNew: boolean
}

interface ChatflowService {
  readonly store: {
    readonly activeSessionId: string
    readonly currentProjectDir: string
    readonly pendingFileModificationsBySession: Record<string, PendingFileMod[]>
    /** 联动焦点通道：可写（本面板消费后置空） */
    diffFocusPath: string
    confirmSessionFiles(sessionId: string, paths: string[]): Promise<void>
    rollbackSessionFiles(sessionId: string, paths: string[]): Promise<void>
  }
}

const chatflow = useService<ChatflowService>('chatflow.store')
const store = chatflow.store

// ── 数据面 ──────────────────────────────────────────────────────────────
const pendingFiles = computed<PendingFileMod[]>(
  () => store.pendingFileModificationsBySession[store.activeSessionId] || [],
)

const totalAdd = computed(() => pendingFiles.value.reduce((s, f) => s + f.additions, 0))
const totalDel = computed(() => pendingFiles.value.reduce((s, f) => s + f.deletions, 0))

/** 选中文件：默认首个；会话切换重置；联动焦点消费（选中 + 清空通道）。
 *  勾选集声明须在 watch 之前（immediate 回调同步执行，声明在后会 TDZ 报错） */
const checkedPaths = ref<Set<string>>(new Set())

const selectedPath = ref('')
watch(
  () => store.activeSessionId,
  () => {
    selectedPath.value = pendingFiles.value[0]?.path || ''
    checkedPaths.value = new Set()
  },
  { immediate: true },
)
watch(
  () => store.diffFocusPath,
  (focus) => {
    if (!focus) return
    if (pendingFiles.value.some((f) => f.path === focus)) selectedPath.value = focus
    store.diffFocusPath = ''
  },
  { immediate: true },
)
// 列表收缩（确认/回滚移除条目）后选中项不在清单时回退首个
watch(pendingFiles, (list) => {
  if (selectedPath.value && !list.some((f) => f.path === selectedPath.value)) {
    selectedPath.value = list[0]?.path || ''
  }
})

const selectedFile = computed(() => pendingFiles.value.find((f) => f.path === selectedPath.value) || null)

const checkedCount = computed(() => checkedPaths.value.size)
const allChecked = computed(
  () => pendingFiles.value.length > 0 && checkedPaths.value.size === pendingFiles.value.length,
)

function toggleCheck(path: string): void {
  const next = new Set(checkedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  checkedPaths.value = next
}

function toggleAll(): void {
  checkedPaths.value = allChecked.value ? new Set() : new Set(pendingFiles.value.map((f) => f.path))
}

/** 动作条目标 = 勾选集（无勾选时按钮禁用；单文件操作走行内 hover 动作） */
function targetPaths(): string[] {
  return [...checkedPaths.value]
}

// ── 动作（确认直接执行；回退破坏性，确认弹窗）────────────────────────────
const acting = ref(false)

async function confirmPaths(paths: string[]): Promise<void> {
  if (paths.length === 0 || acting.value) return
  acting.value = true
  try {
    await store.confirmSessionFiles(store.activeSessionId, paths)
    ElMessage({ message: `已确认 ${paths.length} 个文件`, type: 'success', duration: 2000 })
    checkedPaths.value = new Set()
  } catch {
    ElMessage({ message: '确认失败', type: 'error', duration: 2000 })
  } finally {
    acting.value = false
  }
}

async function rollbackPaths(paths: string[]): Promise<void> {
  if (paths.length === 0 || acting.value) return
  try {
    await ElMessageBox.confirm(
      `将回滚 ${paths.length} 个文件到修改前内容，修改将丢失且不可恢复。`,
      '回滚文件',
      { confirmButtonText: '回滚', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  acting.value = true
  try {
    await store.rollbackSessionFiles(store.activeSessionId, paths)
    ElMessage({ message: `已回滚 ${paths.length} 个文件`, type: 'success', duration: 2000 })
    checkedPaths.value = new Set()
  } catch {
    ElMessage({ message: '回滚失败', type: 'error', duration: 2000 })
  } finally {
    acting.value = false
  }
}

/** 动作条：有勾选对勾选集，否则对选中文件 */
function confirmTargets(): void {
  void confirmPaths(targetPaths())
}
function rollbackTargets(): void {
  void rollbackPaths(targetPaths())
}

// ── 展示辅助 ────────────────────────────────────────────────────────────
/** 相对当前工作目录的短路径（目录外文件回退绝对路径），title 悬浮全路径 */
function shortPath(path: string): string {
  const dir = (store.currentProjectDir || '').replace(/\/+$/, '')
  if (dir && path.startsWith(`${dir}/`)) return path.slice(dir.length + 1)
  return path
}

// unified diff → 行分类（---/+++ 头行过滤，@@ hunk 头 + +/- 着色）
interface DiffLine {
  kind: 'add' | 'del' | 'hunk' | 'ctx'
  text: string
}

const diffLines = computed<DiffLine[]>(() => {
  const text = selectedFile.value?.diff || ''
  if (!text) return []
  const raw = text.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '')
  const lines: DiffLine[] = []
  for (const line of raw) {
    if (line.startsWith('---') || line.startsWith('+++')) continue
    if (line.startsWith('@@')) lines.push({ kind: 'hunk', text: line })
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line })
    else lines.push({ kind: 'ctx', text: line })
  }
  return lines
})
</script>

<template>
  <div class="diff-panel">
    <!-- 空态：无待确认变更 -->
    <div v-if="pendingFiles.length === 0" class="panel-empty">
      <MxIcon name="lucide:git-compare" :size="20" class="empty-icon" />
      <p class="empty-text">当前会话没有待确认的文件变更</p>
    </div>

    <template v-else>
      <!-- 工具行：计数 + 合计 ± + 确认/回退 -->
      <div class="panel-toolbar">
        <label class="check-all">
          <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          <span class="toolbar-count">{{ pendingFiles.length }} 个文件</span>
        </label>
        <span v-if="totalAdd || totalDel" class="toolbar-stat">
          <span class="stat-add">+{{ totalAdd }}</span>
          <span class="stat-del">-{{ totalDel }}</span>
        </span>
        <span class="flex-spacer" />
        <button
          type="button"
          class="tool-btn confirm"
          :disabled="acting || checkedCount === 0"
          title="确认合入勾选文件"
          @click="confirmTargets"
        >
          <MxIcon name="lucide:check" :size="16" />
          <span>确认合入</span>
        </button>
        <button
          type="button"
          class="tool-btn rollback"
          :disabled="acting || checkedCount === 0"
          title="回滚勾选文件"
          @click="rollbackTargets"
        >
          <MxIcon name="lucide:undo-2" :size="16" />
          <span>回退</span>
        </button>
      </div>

      <!-- 文件清单：勾选 + 短路径 + 新文件标记 + ± 徽标 + hover 单文件动作 -->
      <div class="file-list">
        <div
          v-for="f in pendingFiles"
          :key="f.path"
          class="file-row"
          :class="{ selected: f.path === selectedPath }"
          :title="f.path"
          @click="selectedPath = f.path"
        >
          <input
            type="checkbox"
            class="row-check"
            :checked="checkedPaths.has(f.path)"
            @click.stop
            @change="toggleCheck(f.path)"
          />
          <span class="row-path">{{ shortPath(f.path) }}</span>
          <span v-if="f.isNew" class="row-new">新</span>
          <span v-if="f.additions" class="stat-add">+{{ f.additions }}</span>
          <span v-if="f.deletions" class="stat-del">-{{ f.deletions }}</span>
          <span class="row-actions">
            <button type="button" class="row-btn" title="确认合入" @click.stop="confirmPaths([f.path])">
              <MxIcon name="lucide:check" :size="16" />
            </button>
            <button type="button" class="row-btn" title="回滚" @click.stop="rollbackPaths([f.path])">
              <MxIcon name="lucide:undo-2" :size="16" />
            </button>
          </span>
        </div>
      </div>

      <!-- diff 正文：unified diff 行内着色（hunk 灰 / + 绿 / - 红） -->
      <div class="diff-body">
        <template v-if="diffLines.length">
          <div v-for="(ln, i) in diffLines" :key="i" class="diff-line" :class="ln.kind">{{ ln.text }}</div>
        </template>
        <div v-else class="diff-empty">diff 内容暂不可用（待工具回传完整差异）</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.diff-panel {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ── 空态 ── */
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  gap: var(--mx-space-2);
}

.empty-icon {
  color: var(--mx-text-caption);
}

.empty-text {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* ── 工具行 ── */
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
  flex-shrink: 0;
}

.check-all {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  cursor: pointer;
}

.check-all input {
  accent-color: var(--mx-accent, var(--mx-text));
}

.toolbar-count {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-family: var(--mx-font-mono);
  white-space: nowrap;
}

.toolbar-stat {
  display: flex;
  gap: var(--mx-space-1);
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-micro);
}

.stat-add {
  color: var(--mx-success);
}

.stat-del {
  color: var(--mx-danger);
}

.flex-spacer {
  flex: 1;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  background: transparent;
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.tool-btn:hover:not(:disabled) {
  background: var(--mx-hover);
}

.tool-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.tool-btn.confirm span {
  color: var(--mx-success);
}

.tool-btn.rollback span {
  color: var(--mx-danger);
}

/* ── 文件清单（紧凑 28px 行，hover 显单文件动作） ── */
.file-list {
  flex-shrink: 0;
  max-height: 40%;
  overflow-y: auto;
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  margin-bottom: var(--mx-space-2);
}

.file-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  height: 28px;
  padding: 0 var(--mx-space-2);
  cursor: pointer;
  user-select: none;
}

.file-row:hover {
  background: var(--mx-hover);
}

.file-row.selected {
  background: var(--mx-active);
}

.row-check {
  flex-shrink: 0;
  accent-color: var(--mx-accent, var(--mx-text));
}

.row-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  font: var(--mx-font-caption);
  color: var(--mx-text);
}

.row-new {
  flex-shrink: 0;
  font-size: var(--mx-font-micro);
  color: var(--mx-success);
  border: 1px solid var(--mx-success);
  border-radius: 4px;
  padding: 0 3px;
  line-height: 1.4;
}

.file-row .stat-add,
.file-row .stat-del {
  flex-shrink: 0;
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-micro);
}

/* 单文件动作：hover 行显现（默认隐藏避免拥挤） */
.row-actions {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.file-row:hover .row-actions {
  display: inline-flex;
}

.row-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--mx-text-tertiary);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.row-btn:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}

/* ── diff 正文 ── */
.diff-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  line-height: 1.6;
  border-radius: var(--mx-radius-card);
}

.diff-line {
  padding: 0 var(--mx-space-2);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--mx-text-secondary);
}

.diff-line.add {
  color: var(--mx-success);
  background: color-mix(in srgb, var(--mx-success) 10%, transparent);
}

.diff-line.del {
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
}

.diff-line.hunk {
  color: var(--mx-text-tertiary);
  background: color-mix(in srgb, var(--mx-text-tertiary) 10%, transparent);
}

.diff-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}
</style>
