<script setup lang="ts">
/**
 * MemoryPanel —— 会话记忆管理面板（Detail tab，移植自 mindx-desktop MemoryBrowser）。
 * 窄轨道（Detail 240–520px）单栏主从：列表态 ↔ 详情态切换，编辑态内嵌详情。
 * 数据通道：memory.list_by_session / memory.update / memory.delete RPC（daemon
 * 实证），作用域恒为当前会话（chatflow.store 的 activeSessionId）。
 * markdown 渲染 = marked 解析 + DOMPurify 消毒（markdown 插件同款依赖用法）。
 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox, MxIcon, useService } from '@mindx-work/ui-shell-vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// ── 消费侧服务形状声明（插件间禁止 import，本地声明所需最小形状）──────────
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

interface ChatflowService {
  readonly store: { readonly activeSessionId: string }
}

const daemon = useService<DaemonConnection>('daemon.connection')
const chatflow = useService<ChatflowService>('chatflow.store')

// DetailPane 仅渲染活动 tab（:active 恒 true），挂载即拉取
defineProps<{ active?: boolean }>()

// ── 记忆条目（daemon MemoryChunkItem 实证形状）──
interface MemoryChunk {
  id: string
  title: string
  summary: string
  content: string
  session_id: string
  agent_name: string
  tags: string[]
  timestamp: number
}

const memories = ref<MemoryChunk[]>([])
const loading = ref(false)
const loaded = ref(false)

// ── 视图态：list 列表 / detail 详情（编辑态以 editingId 判定）──
type ViewMode = 'list' | 'detail'
const mode = ref<ViewMode>('list')
const selectedId = ref<string | null>(null)
const selectedMemory = computed(() => memories.value.find((m) => m.id === selectedId.value) ?? null)

// ── 编辑态 ──
const editingId = ref<string | null>(null)
const editTitle = ref('')
const editSummary = ref('')
const editContent = ref('')
const editTags = ref<string[]>([])

// ── markdown 渲染（marked + DOMPurify，空白内容原样返回）──
function renderMarkdown(text: string): string {
  if (!text) return ''
  const raw = marked.parse(text, { gfm: true, breaks: true, async: false }) as string
  return DOMPurify.sanitize(raw)
}

// ── 时间格式化（今天仅时刻 / 一周内星期+时刻 / 更早日期+时刻）──
function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (diff < 604800000) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return days[d.getDay()] + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return (
    d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  )
}

// ── 刷新：拉取当前会话记忆（时间倒序，daemon 保证）──
let loadSeq = 0
async function refresh(): Promise<void> {
  const sessionId = chatflow.store.activeSessionId
  if (!sessionId) {
    memories.value = []
    loaded.value = true
    return
  }
  const seq = ++loadSeq
  loading.value = true
  try {
    const result = await daemon.call<{ chunks: MemoryChunk[]; count: number }>('memory.list_by_session', {
      session_id: sessionId,
    })
    if (seq !== loadSeq) return
    memories.value = result?.chunks ?? []
  } catch (err) {
    if (seq !== loadSeq) return
    console.error('[Memory] 记忆列表加载失败:', err)
    memories.value = []
  } finally {
    if (seq === loadSeq) {
      loading.value = false
      loaded.value = true
    }
  }
}
void refresh()

function openDetail(item: MemoryChunk): void {
  selectedId.value = item.id
  editingId.value = null
  mode.value = 'detail'
}

function backToList(): void {
  mode.value = 'list'
  selectedId.value = null
  cancelEdit()
}

// ── 编辑 ──
function startEdit(item: MemoryChunk): void {
  editingId.value = item.id
  editTitle.value = item.title || ''
  editSummary.value = item.summary
  editContent.value = item.content
  editTags.value = [...(item.tags || [])]
}

function cancelEdit(): void {
  editingId.value = null
  editTitle.value = ''
  editSummary.value = ''
  editContent.value = ''
  editTags.value = []
}

async function saveEdit(): Promise<void> {
  if (!selectedMemory.value) return
  const id = selectedMemory.value.id
  const title = editTitle.value.trim()
  const summary = editSummary.value.trim()
  const content = editContent.value.trim()
  const tags = editTags.value
  if (!title && !summary && !content) {
    ElMessage.warning('标题、摘要和内容不能同时为空')
    return
  }
  loading.value = true
  try {
    await daemon.call('memory.update', { id, title, summary, content, tags })
    // 本地同步（对齐源组件缓存更新语义）
    const target = memories.value.find((c) => c.id === id)
    if (target) {
      target.title = title
      target.summary = summary
      target.content = content
      target.tags = tags
    }
    ElMessage.success('已更新')
    cancelEdit()
  } catch (err) {
    console.error('[Memory] 更新失败:', err)
    ElMessage.error('更新失败')
  } finally {
    loading.value = false
  }
}

// ── 删除单条 ──
async function handleDelete(): Promise<void> {
  const target = selectedMemory.value
  if (!target) return
  try {
    await ElMessageBox.confirm('确定要删除这条记忆吗？此操作不可撤销。', '删除记忆', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return // 用户取消
  }
  loading.value = true
  try {
    await daemon.call('memory.delete', { id: target.id })
    memories.value = memories.value.filter((c) => c.id !== target.id)
    ElMessage.success('已删除')
    backToList()
  } catch (err) {
    console.error('[Memory] 删除失败:', err)
    ElMessage.error('删除失败')
  } finally {
    loading.value = false
  }
}

// ── 清空全部（逐条删除，对齐源组件语义）──
const clearingAll = ref(false)
async function handleClearAll(): Promise<void> {
  const count = memories.value.length
  if (count === 0) {
    ElMessage.info('没有可清空的记忆')
    return
  }
  try {
    await ElMessageBox.confirm(`确定要清空全部 ${count} 条记忆吗？此操作不可撤销。`, '清空记忆', {
      confirmButtonText: '清空全部',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  clearingAll.value = true
  let failed = 0
  for (const item of memories.value) {
    try {
      await daemon.call('memory.delete', { id: item.id })
    } catch {
      failed++
    }
  }
  clearingAll.value = false
  backToList()
  if (failed === 0) {
    ElMessage.success(`已清空全部 ${count} 条记忆`)
  } else {
    ElMessage.warning(`已删除 ${count - failed} 条，${failed} 条删除失败`)
  }
  await refresh()
}

/** 列表条目预览：摘要优先，缺省截内容前 80 字 */
function previewOf(item: MemoryChunk): string {
  if (item.summary) return item.summary
  if (!item.content) return ''
  return item.content.length > 80 ? item.content.slice(0, 80) + '...' : item.content
}

/** 条目标题：标题优先，缺省摘要，再缺省占位 */
function titleOf(item: MemoryChunk): string {
  return item.title || item.summary || '(无标题)'
}
</script>

<template>
  <div class="mem-panel">
    <!-- 列表态 -->
    <template v-if="mode === 'list'">
      <div class="mem-toolbar">
        <span class="mem-toolbar-count">{{ memories.length }} 条记忆</span>
        <div class="mem-toolbar-actions">
          <el-button
            size="small"
            :loading="clearingAll"
            :disabled="clearingAll || memories.length === 0"
            @click="handleClearAll"
          >
            清空
          </el-button>
          <el-button size="small" :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>

      <!-- 空态 / 加载态 -->
      <div v-if="memories.length === 0" class="mem-empty">
        <template v-if="loading && !loaded">
          <el-skeleton-item variant="rectangle" class="mem-skeleton-row" />
          <el-skeleton-item variant="rectangle" class="mem-skeleton-row" />
          <el-skeleton-item variant="rectangle" class="mem-skeleton-row" />
        </template>
        <template v-else>
          <MxIcon name="lucide:brain" :size="20" class="mem-empty-icon" />
          <p class="mem-empty-text">当前会话暂无记忆</p>
        </template>
      </div>

      <!-- 条目列表 -->
      <div v-else class="mem-list">
        <button
          v-for="item in memories"
          :key="item.id"
          type="button"
          class="mem-item"
          @click="openDetail(item)"
        >
          <div class="mem-item-header">
            <span class="mem-item-title">{{ titleOf(item) }}</span>
            <span class="mem-item-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <p class="mem-item-preview">{{ previewOf(item) }}</p>
        </button>
      </div>
    </template>

    <!-- 详情态 -->
    <template v-else>
      <div v-if="selectedMemory" class="mem-detail">
        <div class="mem-detail-toolbar">
          <button type="button" class="mem-back-btn" title="返回列表" aria-label="返回列表" @click="backToList">
            <MxIcon name="lucide:arrow-left" :size="16" />
          </button>
          <span class="mem-detail-time">{{ formatTime(selectedMemory.timestamp) }}</span>
        </div>

        <!-- 查看态 -->
        <template v-if="editingId !== selectedMemory.id">
          <h3 class="mem-detail-title">{{ titleOf(selectedMemory) }}</h3>
          <div v-if="selectedMemory.summary" class="mem-detail-summary">{{ selectedMemory.summary }}</div>
          <!-- eslint-disable-next-line vue/no-v-html —— 内容经 marked 解析 + DOMPurify 消毒 -->
          <div class="mem-detail-content mem-markdown" v-html="renderMarkdown(selectedMemory.content)"></div>
          <div v-if="selectedMemory.tags && selectedMemory.tags.length > 0" class="mem-detail-tags">
            <span v-for="tag in selectedMemory.tags" :key="tag" class="mem-tag">{{ tag }}</span>
          </div>
          <div class="mem-detail-actions">
            <button type="button" class="mem-action-btn mem-edit-btn" @click="startEdit(selectedMemory)">
              <MxIcon name="lucide:pencil" :size="16" />
              <span>编辑</span>
            </button>
            <button type="button" class="mem-action-btn mem-delete-btn" @click="handleDelete">
              <MxIcon name="lucide:trash-2" :size="16" />
              <span>删除</span>
            </button>
          </div>
        </template>

        <!-- 编辑态 -->
        <template v-else>
          <div class="mem-edit-section">
            <div class="mem-edit-field">
              <label class="mem-edit-label">标题</label>
              <input v-model="editTitle" class="mem-edit-input" placeholder="主题标题（≤15字）" />
            </div>
            <div class="mem-edit-field">
              <label class="mem-edit-label">摘要</label>
              <input v-model="editSummary" class="mem-edit-input" placeholder="核心结论（一两句话）" />
            </div>
            <div class="mem-edit-field">
              <label class="mem-edit-label">内容</label>
              <textarea v-model="editContent" class="mem-edit-textarea" placeholder="详细要点（分条列举）" rows="10"></textarea>
            </div>
            <div class="mem-edit-field">
              <label class="mem-edit-label">标签</label>
              <el-select
                v-model="editTags"
                multiple
                allow-create
                filterable
                default-first-option
                placeholder="输入标签后回车"
                class="mem-tag-select"
                size="small"
              />
            </div>
            <div class="mem-edit-actions">
              <el-button size="small" @click="cancelEdit">取消</el-button>
              <el-button size="small" type="primary" :loading="loading" @click="saveEdit">
                {{ loading ? '保存中...' : '保存' }}
              </el-button>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mem-panel {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ── 工具行 ── */
.mem-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
  flex-shrink: 0;
}

.mem-toolbar-count {
  font-size: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-family: var(--mx-font-mono);
}

.mem-toolbar-actions {
  display: flex;
  gap: var(--mx-space-1);
}

/* ── 空态 ── */
.mem-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  gap: var(--mx-space-2);
}

.mem-empty-icon {
  color: var(--mx-text-caption);
}

.mem-empty-text {
  font-size: var(--mx-font-body);
  color: var(--mx-text-tertiary);
  margin: 0;
}

.mem-skeleton-row {
  display: block;
  width: 100%;
  height: 56px;
  border-radius: var(--mx-radius-control);
}

/* ── 列表 ── */
.mem-list {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.mem-item {
  display: block;
  width: 100%;
  padding: var(--mx-space-2) var(--mx-space-2);
  box-sizing: border-box;
  font: var(--mx-font-body);
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.mem-item:hover {
  background: var(--mx-hover);
}

.mem-item:active {
  background: var(--mx-active);
}

.mem-item:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.mem-item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mx-space-1);
  margin-bottom: 2px;
}

.mem-item-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: var(--mx-font-caption);
  color: var(--mx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mem-item-time {
  flex-shrink: 0;
  font-size: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
}

.mem-item-preview {
  margin: 0;
  font-size: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 详情 ── */
.mem-detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
}

.mem-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--mx-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.mem-back-btn:hover {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.mem-detail-time {
  font-size: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
}

.mem-detail-title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
  margin: 0 0 var(--mx-space-2);
  line-height: 1.4;
  word-break: break-word;
}

.mem-detail-summary {
  font-size: var(--mx-font-caption);
  color: var(--mx-accent);
  line-height: 1.6;
  margin-bottom: var(--mx-space-3);
  padding: var(--mx-space-2) var(--mx-space-2);
  background: color-mix(in srgb, var(--mx-accent) 6%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--mx-accent) 40%, transparent);
  border-radius: 0 var(--mx-radius-control) var(--mx-radius-control) 0;
}

.mem-detail-content {
  font-size: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.8;
  margin-bottom: var(--mx-space-3);
  word-break: break-word;
}

/* markdown 渲染后由元素自身控制换行（pre-wrap 会产生双换行） */
.mem-detail-content.mem-markdown {
  white-space: normal;
}

.mem-markdown :deep(h1),
.mem-markdown :deep(h2),
.mem-markdown :deep(h3),
.mem-markdown :deep(h4) {
  color: var(--mx-text);
  font-weight: 700;
  margin: var(--mx-space-3) 0 var(--mx-space-1);
  line-height: 1.4;
}

.mem-markdown :deep(h1) { font-size: var(--mx-font-body); }
.mem-markdown :deep(h2) { font-size: var(--mx-font-body); }
.mem-markdown :deep(h3),
.mem-markdown :deep(h4) { font-size: var(--mx-font-caption); }

.mem-markdown :deep(p) {
  margin: var(--mx-space-1) 0;
}

.mem-markdown :deep(strong) {
  color: var(--mx-text);
  font-weight: 600;
}

.mem-markdown :deep(em) {
  color: var(--mx-accent);
}

.mem-markdown :deep(code) {
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-micro);
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  color: var(--mx-accent);
  padding: 1px 4px;
  border-radius: 4px;
}

.mem-markdown :deep(pre) {
  background: color-mix(in srgb, var(--mx-bg-surface) 60%, transparent);
  border: 1px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-2);
  margin: var(--mx-space-2) 0;
  overflow-x: auto;
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-micro);
  line-height: 1.6;
  color: var(--mx-text);
}

.mem-markdown :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}

.mem-markdown :deep(ul),
.mem-markdown :deep(ol) {
  padding-left: var(--mx-space-4);
  margin: var(--mx-space-1) 0;
}

.mem-markdown :deep(li) {
  margin: 2px 0;
}

.mem-markdown :deep(blockquote) {
  border-left: 3px solid color-mix(in srgb, var(--mx-accent) 50%, transparent);
  padding-left: var(--mx-space-2);
  margin: var(--mx-space-2) 0;
  color: var(--mx-text-tertiary);
  font-style: italic;
}

.mem-markdown :deep(a) {
  color: var(--mx-accent);
  text-decoration: none;
}

.mem-markdown :deep(a:hover) {
  text-decoration: underline;
}

.mem-markdown :deep(table) {
  border-collapse: collapse;
  margin: var(--mx-space-2) 0;
  font-size: var(--mx-font-micro);
}

.mem-markdown :deep(th),
.mem-markdown :deep(td) {
  border: 1px solid var(--mx-separator-soft);
  padding: 2px var(--mx-space-1);
}

.mem-markdown :deep(th) {
  background: var(--mx-hover);
  color: var(--mx-text);
  font-weight: 600;
}

.mem-markdown :deep(img) {
  max-width: 100%;
  border-radius: var(--mx-radius-control);
}

.mem-markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--mx-separator-soft);
  margin: var(--mx-space-3) 0;
}

/* 标签 */
.mem-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mx-space-1);
  margin-bottom: var(--mx-space-3);
}

.mem-tag {
  display: inline-block;
  padding: 1px var(--mx-space-2);
  font-size: var(--mx-font-micro);
  font-weight: 500;
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 20%, transparent);
  border-radius: 999px;
  white-space: nowrap;
}

/* 动作钮 */
.mem-detail-actions {
  display: flex;
  gap: var(--mx-space-2);
  padding-top: var(--mx-space-3);
  border-top: 1px solid var(--mx-separator-soft);
}

.mem-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--mx-space-1) var(--mx-space-2);
  font-size: var(--mx-font-caption);
  font-weight: 600;
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  background: transparent;
  cursor: pointer;
  transition: all var(--mx-duration-fast) var(--mx-ease-standard);
}

.mem-edit-btn {
  color: var(--mx-text-secondary);
}

.mem-edit-btn:hover {
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
  border-color: color-mix(in srgb, var(--mx-accent) 20%, transparent);
}

.mem-delete-btn {
  color: var(--mx-text-secondary);
}

.mem-delete-btn:hover {
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 8%, transparent);
  border-color: color-mix(in srgb, var(--mx-danger) 20%, transparent);
}

/* 编辑态 */
.mem-edit-field {
  margin-bottom: var(--mx-space-3);
}

.mem-edit-label {
  display: block;
  font-size: var(--mx-font-micro);
  font-weight: 600;
  color: var(--mx-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--mx-space-1);
}

.mem-edit-input {
  width: 100%;
  padding: var(--mx-space-1) var(--mx-space-2);
  font-size: var(--mx-font-caption);
  color: var(--mx-text);
  background: color-mix(in srgb, var(--mx-bg-surface) 45%, transparent);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  outline: none;
  transition: border-color var(--mx-duration-fast) var(--mx-ease-standard);
  box-sizing: border-box;
}

.mem-edit-input:focus {
  border-color: var(--mx-accent);
}

.mem-edit-input::placeholder {
  color: color-mix(in srgb, var(--mx-text-tertiary) 60%, transparent);
}

.mem-edit-textarea {
  width: 100%;
  padding: var(--mx-space-1) var(--mx-space-2);
  font-size: var(--mx-font-caption);
  color: var(--mx-text);
  background: color-mix(in srgb, var(--mx-bg-surface) 45%, transparent);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  outline: none;
  transition: border-color var(--mx-duration-fast) var(--mx-ease-standard);
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
  min-height: 200px;
}

.mem-edit-textarea:focus {
  border-color: var(--mx-accent);
}

.mem-edit-textarea::placeholder {
  color: color-mix(in srgb, var(--mx-text-tertiary) 60%, transparent);
}

.mem-tag-select {
  width: 100%;
}

.mem-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-1);
  margin-top: var(--mx-space-2);
}
</style>
