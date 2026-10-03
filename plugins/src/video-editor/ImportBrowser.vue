<script setup lang="ts">
/**
 * 导入浏览器（Overlay modal）：daemon fs.list 逐目录浏览工作区，列目录与
 * 媒体文件（视频 / 音频 / 图片扩展名过滤），目录单击进入，媒体单击选中
 * （跨目录累计），确认后批量探测导入。起点取 chatflow 当前工作目录
 * （chatflow 可停用，拿不到则退回用户主目录）。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useVideoEditorStore } from './store'
import { kindOfExt } from './engine/probe'

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

interface FsEntry {
  name: string
  path: string
  is_dir: boolean
}

interface ChatflowServiceLike {
  store: { currentProjectDir?: string }
}

const BROWSER_ID = 'video-editor-import-browser'

const shell = useShell()
const store = useVideoEditorStore()

const daemon = shell.services.use<DaemonConnection>('daemon.connection')

/** 起点目录：chatflow 工作目录优先（拿不到走主目录，由挂载期 fs.home 解析） */
let chatflow: ChatflowServiceLike | null = null
try {
  chatflow = shell.services.use<ChatflowServiceLike>('chatflow.store')
} catch {
  chatflow = null
}

const dir = ref('')
const entries = ref<FsEntry[]>([])
const loading = ref(false)
const error = ref('')
const selected = ref<Set<string>>(new Set())
const importing = ref(false)

const crumbs = computed(() => {
  const segs = dir.value.split('/').filter(Boolean)
  const list: Array<{ name: string; path: string }> = [{ name: '主目录', path: homeDir.value || '/' }]
  let acc = ''
  for (const seg of segs) {
    acc += `/${seg}`
    list.push({ name: seg, path: acc })
  }
  return list
})

const homeDir = ref('')

/** 媒体文件可入选，目录可进入；其余形态（含非媒体）不列 */
function isMedia(entry: FsEntry): boolean {
  return !entry.is_dir && kindOfExt(entry.name) !== null
}

async function list(target: string): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const list = await daemon.call<FsEntry[]>('fs.list', { path: target })
    entries.value = list
      .filter((e) => e.is_dir || isMedia(e))
      .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1))
    dir.value = target
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function enter(entry: FsEntry): void {
  if (entry.is_dir) void list(entry.path)
}

function toggleSelect(entry: FsEntry): void {
  const next = new Set(selected.value)
  if (next.has(entry.path)) next.delete(entry.path)
  else next.add(entry.path)
  selected.value = next
}

async function confirmImport(): Promise<void> {
  const paths = [...selected.value]
  if (paths.length === 0) return
  importing.value = true
  try {
    const outcome = await store.importPaths(paths)
    // 全部失败保留弹窗让用户重选；部分失败关闭并透出失败明细（探测失败不再静默）
    if (outcome.ok.length === 0 && outcome.failed.length > 0) {
      ElMessage.error(outcome.failed.map((f) => `「${f.name}」${f.reason}`).join('；'))
      return
    }
    if (outcome.failed.length > 0) {
      ElMessage.warning(`已导入 ${outcome.ok.length} 项，${outcome.failed.length} 项失败：${outcome.failed.map((f) => f.name).join('、')}`)
    }
    close()
  } finally {
    importing.value = false
  }
}

// 守卫重复触发：条目已移除时不再调用 remove
function close(): void {
  if (shell.Overlay.has(BROWSER_ID)) shell.Overlay.remove(BROWSER_ID)
}

onMounted(async () => {
  try {
    // daemon 实证：fs.home 返回 { path } 对象（handler_fs.go），不是纯字符串
    const home = await daemon.call<{ path: string }>('fs.home')
    homeDir.value = home?.path || '/'
  } catch {
    homeDir.value = '/'
  }
  const start = chatflow?.store.currentProjectDir || homeDir.value
  await list(start)
})
</script>

<template>
  <div :class="$style.browser">
    <div :class="$style.head">
      <MxIcon name="lucide:folder-open" :size="16" />
      <h2 :class="$style.heading">选择媒体素材</h2>
      <span :class="$style.spacer" />
      <button type="button" class="mx-icon-btn" aria-label="关闭" @click="close">
        <MxIcon name="lucide:x" :size="16" />
      </button>
    </div>

    <div :class="$style.crumbs">
      <template v-for="(crumb, index) in crumbs" :key="crumb.path">
        <span v-if="index > 0" :class="$style.sep">/</span>
        <button
          type="button"
          :class="$style.crumb"
          :disabled="index === crumbs.length - 1"
          @click="list(crumb.path)"
        >
          {{ crumb.name }}
        </button>
      </template>
    </div>

    <div :class="$style.list">
      <div v-if="loading" :class="$style.state">读取中…</div>
      <div v-else-if="error" :class="$style.state">{{ error }}</div>
      <div v-else-if="entries.length === 0" :class="$style.state">此目录没有可导入的媒体文件</div>
      <template v-else>
        <button
          v-for="entry in entries"
          :key="entry.path"
          type="button"
          :class="$style.row"
          :data-state="selected.has(entry.path) ? 'selected' : 'idle'"
          @click="entry.is_dir ? enter(entry) : toggleSelect(entry)"
        >
          <MxIcon :name="entry.is_dir ? 'lucide:folder' : 'lucide:film'" :size="16" />
          <span :class="$style.rowName">{{ entry.name }}</span>
          <MxIcon
            v-if="selected.has(entry.path)"
            name="lucide:circle-check"
            :size="16"
            :class="$style.check"
          />
        </button>
      </template>
    </div>

    <div :class="$style.actions">
      <span :class="$style.count">已选 {{ selected.size }} 项</span>
      <span :class="$style.spacer" />
      <button type="button" class="mx-btn" @click="close">取消</button>
      <button
        type="button"
        class="mx-btn mx-btn--primary"
        :disabled="selected.size === 0 || importing"
        @click="confirmImport"
      >
        {{ importing ? '导入中…' : '导入所选' }}
      </button>
    </div>
  </div>
</template>

<style module>
.browser {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  /* 宽度意愿 520px；max-width 100% 收进壳层 modalCard 内容区（卡片 max-width 含
   * 自身 padding，实际内容上限 < 520px）——写死不设上限会把头部 × 与底部按钮行
   * 顶出卡片右缘（2026-10-02 实测截图） */
  width: 520px;
  max-width: 100%;
}

.head {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  color: var(--mx-text-secondary);
}

.heading {
  font: var(--mx-font-heading);
  color: var(--mx-text);
  margin: 0;
}

.spacer {
  flex: 1;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-wrap: wrap;
  font: var(--mx-font-caption);
}

.sep {
  color: var(--mx-text-tertiary);
}

.crumb {
  border: none;
  background: none;
  padding: 2px 4px;
  border-radius: var(--mx-radius-control);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  cursor: pointer;
}

.crumb:hover:not(:disabled) {
  background: var(--mx-hover);
  color: var(--mx-text);
}

.crumb:active:not(:disabled) {
  background: var(--mx-active);
}

.crumb:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.crumb:disabled {
  cursor: default;
  color: var(--mx-text);
  font-weight: 600;
}

.list {
  height: 320px;
  overflow-y: auto;
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  padding: var(--mx-space-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.state {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  text-align: center;
  padding: var(--mx-space-6) 0;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  border: none;
  background: none;
  padding: 6px var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  color: var(--mx-text-secondary);
  font: var(--mx-font-body);
  cursor: pointer;
  text-align: left;
}

.row:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}

.row:active {
  background: var(--mx-active);
}

.row:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.row:disabled {
  cursor: default;
  opacity: 0.5;
}

.row[data-state='selected'] {
  background: var(--mx-nav-active);
  color: var(--mx-text);
}

.rowName {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.check {
  color: var(--mx-accent);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.count {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
