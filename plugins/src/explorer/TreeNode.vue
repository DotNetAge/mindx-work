<script setup lang="ts">
/**
 * TreeNode：explorer 目录树节点（递归组件）。
 * 目录行 = chevron（展开 v / 收起 > / 加载转圈）+ 文件夹图标（展开开盖）+ 名称；
 * 文件行 = 类型图标（seti 风：md 文档、json {}、yml !、图片、代码）+ 名称。
 * 缩进 = 深度 × 14px。右键打开上下文菜单（store.openCtx，菜单由 DetailPanel 渲染）。
 * 内联重命名（store.renamingPath 命中本行渲染 input，enter 确认 esc 取消）。
 * phantom 新建行（store.creating.parent 命中本目录子层首行渲染 input）。
 * 点击目录懒加载展开；点击文件按扩展名路由（markdown / 图片进对应插件，其余定位高亮）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon, useService } from '@mindx-work/ui-shell-vue'
import { useExplorerStore, type FsEntry } from './store'

const props = defineProps<{
  entry: FsEntry
  depth: number
}>()

const store = useExplorerStore()

// 消费侧本地服务形状（插件间禁止 import，仅声明所需最小形状）
interface MarkerServiceLike {
  readonly store: { open(path: string): Promise<void> }
}
interface ImageViewerServiceLike {
  readonly store: { open(path: string): Promise<void> }
}
// 服务外壳在 setup 捕获（useService 是 inject，只能在组件同步上下文调用）；
// 缺失（插件停用）静默降级为仅定位高亮。
let markdownSvc: MarkerServiceLike | null = null
let imageSvc: ImageViewerServiceLike | null = null
try {
  markdownSvc = useService<MarkerServiceLike>('markdown.store')
} catch {
  markdownSvc = null
}
try {
  imageSvc = useService<ImageViewerServiceLike>('image-viewer.store')
} catch {
  imageSvc = null
}

const MARKDOWN_EXTS = new Set(['md', 'markdown'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

function extOf(path: string): string {
  const base = path.split('/').pop() || path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 子项清单（已加载才有；未加载 undefined 不渲染子层）；过滤态绕过展开态呈现命中链 */
const kids = computed<FsEntry[] | undefined>(() => {
  const list = store.children[props.entry.path]
  const q = store.filter.trim().toLowerCase()
  if (!list || !q) return list
  const hasMatch = (e: FsEntry): boolean => {
    if (e.name.toLowerCase().includes(q)) return true
    if (!e.is_dir) return false
    return (store.children[e.path] || []).some(hasMatch)
  }
  return list.filter(hasMatch)
})
const isOpen = computed(() => !!store.expanded[props.entry.path])
const filtering = computed(() => !!store.filter.trim())
const isLoading = computed(() => !!store.loadingDirs[props.entry.path])
const selected = computed(() => store.highlightPath === props.entry.path)

// ── 内联重命名（store.renamingPath 命中本行；enter 确认 esc 取消 blur 确认）──
const renaming = computed(() => store.renamingPath === props.entry.path)
const renameValue = ref('')
watch(renaming, (on) => {
  if (on) renameValue.value = props.entry.name
})

/** 函数 ref：挂载即聚焦全选（重命名 / phantom 新建输入共用） */
function focusInput(el: unknown): void {
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

async function confirmRename(): Promise<void> {
  const name = renameValue.value.trim()
  const src = props.entry.path
  store.renamingPath = ''
  if (!name || name === props.entry.name) return
  try {
    await store.rename(src, name)
  } catch (e) {
    ElMessage.error('重命名失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function cancelRename(): void {
  store.renamingPath = ''
}

// ── phantom 新建行（store.creating.parent 命中本目录子层首行）───────────────
const creatingHere = computed(
  () => !!store.creating && store.creating.parent === props.entry.path
)
const phantomName = ref('')

async function confirmCreate(): Promise<void> {
  const c = store.creating
  const name = phantomName.value.trim()
  store.creating = null
  phantomName.value = ''
  if (!c || !name) return
  try {
    if (c.dir) await store.makeDir(c.parent, name)
    else await store.makeFile(c.parent, name)
  } catch (e) {
    ElMessage.error('创建失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function cancelCreate(): void {
  store.creating = null
  phantomName.value = ''
}

/** 点击行：目录懒加载展开；文件按扩展名路由（其余定位高亮） */
function onClick(): void {
  if (props.entry.is_dir) {
    void store.toggle(props.entry.path)
    return
  }
  store.highlightPath = props.entry.path
  const ext = extOf(props.entry.path)
  if (MARKDOWN_EXTS.has(ext)) {
    if (markdownSvc) void markdownSvc.store.open(props.entry.path)
    else ElMessage.warning('Markdown 查看器未启用')
  } else if (IMAGE_EXTS.has(ext)) {
    if (imageSvc) void imageSvc.store.open(props.entry.path)
    else ElMessage.warning('图片查看器未启用')
  }
}

/** 右键：上抛目标与指针位置（菜单由 DetailPanel 统一渲染） */
function onCtx(event: MouseEvent): void {
  store.openCtx(props.entry, event.clientX, event.clientY)
}
</script>

<template>
  <div>
    <!-- phantom 新建行（本目录子层首行；enter 确认 esc/blur 取消） -->
    <div
      v-if="creatingHere"
      :class="$style.row"
      :style="{ paddingLeft: `${8 + (props.depth + 1) * 14}px` }"
      @click.stop
      @contextmenu.stop.prevent
    >
      <span :class="$style.leafGap" />
      <MxIcon
        :name="store.creating?.dir ? 'lucide:folder' : 'lucide:file'"
        :size="16"
        :class="$style.fileIcon"
      />
      <input
        v-model="phantomName"
        :class="$style.inlineInput"
        type="text"
        spellcheck="false"
        placeholder="输入名称后回车"
        :ref="focusInput"
        @keydown.enter.prevent="confirmCreate"
        @keydown.esc.prevent="cancelCreate"
        @blur="cancelCreate"
        @click.stop
      />
    </div>
    <!-- 内联重命名行（替换本行呈现；enter 确认 esc 取消 blur 确认） -->
    <div
      v-else-if="renaming"
      :class="$style.row"
      :style="{ paddingLeft: `${8 + props.depth * 14}px` }"
      @click.stop
      @contextmenu.stop.prevent
    >
      <MxIcon
        :name="entry.is_dir ? (isOpen ? 'lucide:folder-open' : 'lucide:folder') : 'lucide:file'"
        :size="16"
        :class="$style.fileIcon"
      />
      <input
        v-model="renameValue"
        :class="$style.inlineInput"
        type="text"
        spellcheck="false"
        :ref="focusInput"
        @keydown.enter.prevent="confirmRename"
        @keydown.esc.prevent="cancelRename"
        @blur="confirmRename"
        @click.stop
      />
    </div>
    <!-- 常规行：目录（chevron + 文件夹图标）/ 文件（类型图标） -->
    <button
      v-else
      type="button"
      :class="[$style.row, { [$style.rowHighlight]: selected }]"
      :style="{ paddingLeft: `${8 + props.depth * 14}px` }"
      :data-name="entry.name"
      :title="entry.path"
      @click="onClick"
      @contextmenu.prevent="onCtx"
    >
      <MxIcon
        v-if="entry.is_dir"
        :name="
          isLoading
            ? 'lucide:loader-circle'
            : isOpen
              ? 'lucide:chevron-down'
              : 'lucide:chevron-right'
        "
        :size="16"
        :class="[$style.chevron, { [$style.chevronSpin]: isLoading }]"
      />
      <span v-else :class="$style.leafGap" />
      <!-- 文件夹图标：展开开盖 / 收起合盖 -->
      <MxIcon
        v-if="entry.is_dir"
        :name="isOpen ? 'lucide:folder-open' : 'lucide:folder'"
        :size="16"
        :class="$style.fileIcon"
      />
      <template v-else>
        <span v-if="['json', 'yml', 'yaml'].includes(extOf(entry.path))" :class="$style.glyph">{{
          extOf(entry.path) === 'json' ? '{}' : '!'
        }}</span>
        <MxIcon
          v-else
          :name="
            MARKDOWN_EXTS.has(extOf(entry.path))
              ? 'lucide:file-text'
              : IMAGE_EXTS.has(extOf(entry.path))
                ? 'lucide:image'
                : ['ts', 'tsx', 'js', 'jsx', 'vue', 'go', 'rs', 'py', 'sh', 'css', 'html'].includes(
                      extOf(entry.path)
                    )
                  ? 'lucide:file-code'
                  : 'lucide:file'
          "
          :size="16"
          :class="$style.fileIcon"
        />
      </template>
      <span :class="$style.rowName">{{ entry.name }}</span>
    </button>
    <!-- 子层：懒加载完成且展开时渲染（过滤态绕过展开态，呈现全部已加载命中链） -->
    <template v-if="entry.is_dir && kids && (isOpen || filtering)">
      <TreeNode v-for="kid in kids" :key="kid.path" :entry="kid" :depth="props.depth + 1" />
    </template>
  </div>
</template>

<style module>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 26px;
  padding-right: var(--mx-space-2);
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--mx-text);
  font: var(--mx-font-caption);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}

div.row {
  cursor: default;
}

.row:hover {
  background: var(--mx-hover);
}

.row:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: -1px;
}

/* 选中高亮（open 命令定位 / 点击文件） */
.rowHighlight {
  background: var(--mx-active);
}

.rowHighlight:hover {
  background: var(--mx-active);
}

.chevron {
  flex-shrink: 0;
  color: var(--mx-text-tertiary);
}

.chevronSpin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 文件行 chevron 占位（与目录行文字对齐） */
.leafGap {
  width: 16px;
  flex-shrink: 0;
}

.fileIcon {
  flex-shrink: 0;
  color: var(--mx-text-secondary);
}

/* seti 风文字形图标（{} / !）：等宽小字 */
.glyph {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  color: var(--mx-text-secondary);
}

.rowName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 内联编辑 / phantom 新建输入：行内紧凑 */
.inlineInput {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--mx-border-strong);
  border-radius: 4px;
  background: var(--mx-bg-surface);
  color: var(--mx-text);
  font: var(--mx-font-caption);
  outline: none;
}
</style>
