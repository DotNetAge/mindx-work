<script setup lang="ts">
/**
 * markdown 详情面板：头部（文件名 + 脏标记 + 模式切换 + 保存）+ 预览/编辑双态。
 * 预览 = marked 解析 + DOMPurify 消毒（同包依赖直接消费，非跨插件 import）；
 * 编辑 = CodeMirror 6 源码（共用内核 CodeMirrorPane）+ 顶部插入元素工具栏，
 * Cmd/Ctrl+S 保存（fs.write 写回）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { CodeMirrorPane, MxIcon } from '@mindx-work/ui-shell-vue'
import { useMarkdownStore } from './store'

const store = useMarkdownStore()

/** 文件名（basename） */
const fileName = computed(() => store.currentFile.split('/').pop() || store.currentFile)

/** markdown → 安全 HTML（gfm + 换行转义，与对话流同参数） */
const renderedHtml = computed(() => {
  if (store.mode !== 'preview') return ''
  const raw = marked.parse(store.draft, { gfm: true, breaks: true, async: false }) as string
  return DOMPurify.sanitize(raw)
})

// ── 插入元素工具栏（仅编辑态）：三类操作 = 包裹 / 行前缀 / 新块 ──────────────
interface PaneCommands {
  wrapSelection(before: string, after?: string): void
  insertLinePrefix(prefix: string): void
  insertBlock(text: string): void
}

interface MdTool {
  icon: string
  label: string
  apply: (pane: PaneCommands) => void
}

const TOOLS: MdTool[] = [
  { icon: 'lucide:heading-1', label: '一级标题', apply: (p) => p.insertLinePrefix('# ') },
  { icon: 'lucide:heading-2', label: '二级标题', apply: (p) => p.insertLinePrefix('## ') },
  { icon: 'lucide:heading-3', label: '三级标题', apply: (p) => p.insertLinePrefix('### ') },
  { icon: 'lucide:bold', label: '粗体', apply: (p) => p.wrapSelection('**') },
  { icon: 'lucide:italic', label: '斜体', apply: (p) => p.wrapSelection('*') },
  { icon: 'lucide:strikethrough', label: '删除线', apply: (p) => p.wrapSelection('~~') },
  { icon: 'lucide:code', label: '行内代码', apply: (p) => p.wrapSelection('`') },
  { icon: 'lucide:square-code', label: '代码块', apply: (p) => p.wrapSelection('```\n', '\n```') },
  { icon: 'lucide:link', label: '链接', apply: (p) => p.wrapSelection('[', '](https://)') },
  { icon: 'lucide:image', label: '图片', apply: (p) => p.insertBlock('![图片描述](图片路径)\n') },
  { icon: 'lucide:quote', label: '引用', apply: (p) => p.insertLinePrefix('> ') },
  { icon: 'lucide:list', label: '无序列表', apply: (p) => p.insertLinePrefix('- ') },
  { icon: 'lucide:list-ordered', label: '有序列表', apply: (p) => p.insertLinePrefix('1. ') },
  { icon: 'lucide:list-todo', label: '任务列表', apply: (p) => p.insertLinePrefix('- [ ] ') },
  {
    icon: 'lucide:table',
    label: '表格',
    apply: (p) => p.insertBlock('| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n|  |  |  |\n'),
  },
  { icon: 'lucide:minus', label: '分割线', apply: (p) => p.insertBlock('---\n') },
]

const paneRef = ref<InstanceType<typeof CodeMirrorPane> | null>(null)

function applyTool(tool: MdTool): void {
  const pane = paneRef.value
  if (!pane) return
  tool.apply(pane)
}

// ── Cmd/Ctrl+S 保存（编辑模式时拦截浏览器默认保存）──────────────────────────
function onKeydown(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
  if (store.mode !== 'edit' || !store.dirty) return
  e.preventDefault()
  void store.save()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div :class="$style.panel">
    <!-- 头部：文件名 + 脏点 + 模式切换 + 保存 -->
    <div :class="$style.header">
      <span :class="$style.fileName" :title="store.currentFile">
        <MxIcon name="lucide:file-text" :size="16" />
        {{ fileName || '未打开文件' }}
        <span v-if="store.dirty" :class="$style.dot" aria-label="未保存"></span>
      </span>
      <div :class="$style.modes" role="tablist">
        <button
          type="button"
          :class="$style.modeTab"
          role="tab"
          :aria-selected="store.mode === 'preview'"
          @click="store.setMode('preview')"
        >
          预览
        </button>
        <button
          type="button"
          :class="$style.modeTab"
          role="tab"
          :aria-selected="store.mode === 'edit'"
          @click="store.setMode('edit')"
        >
          编辑
        </button>
      </div>
      <button
        v-if="store.mode === 'edit' && store.dirty"
        type="button"
        :class="$style.saveBtn"
        :disabled="store.saving"
        @click="store.save()"
      >
        <MxIcon name="lucide:save" :size="16" />
        保存
      </button>
    </div>

    <!-- 空态 -->
    <p v-if="!store.currentFile" :class="$style.hint">尚未打开任何 Markdown 文件</p>

    <!-- 错误态（打开失败反馈） -->
    <p v-else-if="store.error" :class="$style.error">{{ store.error }}</p>

    <!-- 预览态 -->
    <div v-else-if="store.mode === 'preview'" :class="$style.preview">
      <!-- 内容经 DOMPurify 消毒后注入 -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="md-preview" v-html="renderedHtml"></div>
    </div>

    <!-- 编辑态：插入元素工具栏 + CodeMirror 源码编辑（共用内核） -->
    <div v-else :class="$style.editArea">
      <div :class="$style.toolbar" role="toolbar" aria-label="Markdown 插入工具栏">
        <button
          v-for="tool in TOOLS"
          :key="tool.icon"
          type="button"
          :class="$style.toolBtn"
          :title="tool.label"
          :aria-label="tool.label"
          @click="applyTool(tool)"
        >
          <MxIcon :name="tool.icon" :size="16" />
        </button>
      </div>
      <CodeMirrorPane
        ref="paneRef"
        :value="store.draft"
        lang="md"
        placeholder="输入 Markdown 内容"
        @update:value="store.setDraft"
        @save="store.save()"
      />
    </div>
  </div>
</template>

<style module>
.panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
}

.header {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  flex-shrink: 0;
}

.fileName {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--mx-state-warn);
  flex-shrink: 0;
}

.modes {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--mx-radius-control);
  background: var(--mx-hover);
  flex-shrink: 0;
}

.modeTab {
  height: 24px;
  padding: 0 var(--mx-space-3);
  border: none;
  border-radius: 6px;
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  cursor: pointer;
}

.modeTab:hover {
  color: var(--mx-text);
}

.modeTab:active {
  color: var(--mx-text);
}

.modeTab:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: 1px;
}

.modeTab[aria-selected='true'] {
  background: var(--mx-menu-bg);
  color: var(--mx-text);
  font-weight: 500;
}

.modeTab[aria-selected='true']:hover {
  color: var(--mx-text);
}

.saveBtn {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  height: 28px;
  padding: 0 var(--mx-space-3);
  border: none;
  border-radius: var(--mx-radius-control);
  background: var(--mx-accent);
  font: var(--mx-font-caption);
  color: var(--mx-static-white);
  cursor: pointer;
  flex-shrink: 0;
}

.saveBtn:hover {
  filter: brightness(1.08);
}

.saveBtn:active {
  filter: brightness(0.95);
}

.saveBtn:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: 1px;
}

.saveBtn:disabled {
  opacity: 0.6;
  cursor: default;
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  margin: 0;
}

.preview {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--mx-space-2) var(--mx-space-1);
  font: var(--mx-font-body);
  color: var(--mx-text);
  line-height: 1.7;
  word-wrap: break-word;
}

.preview :global(.md-preview) h1,
.preview :global(.md-preview) h2,
.preview :global(.md-preview) h3 {
  font: var(--mx-font-heading);
  color: var(--mx-text);
  margin: var(--mx-space-3) 0 var(--mx-space-2);
}

.preview :global(.md-preview) p {
  margin: var(--mx-space-2) 0;
}

.preview :global(.md-preview) a {
  color: var(--mx-accent);
  text-decoration: none;
}

.preview :global(.md-preview) a:hover {
  text-decoration: underline;
}

.preview :global(.md-preview) a:active {
  color: var(--mx-accent);
}

.preview :global(.md-preview) code {
  font-family: var(--mx-font-mono);
  font-size: 12px;
  background: var(--mx-hover);
  padding: 1px 6px;
  border-radius: var(--mx-radius-control);
}

.preview :global(.md-preview) pre {
  background: var(--mx-bg-surface);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-3);
  overflow-x: auto;
}

.preview :global(.md-preview) pre code {
  background: none;
  padding: 0;
}

.preview :global(.md-preview) blockquote {
  border-left: 3px solid var(--mx-separator);
  padding-left: var(--mx-space-3);
  margin: var(--mx-space-3) 0;
  color: var(--mx-text-tertiary);
}

.preview :global(.md-preview) ul,
.preview :global(.md-preview) ol {
  padding-left: var(--mx-space-6);
  margin: var(--mx-space-2) 0;
}

.preview :global(.md-preview) li {
  margin: var(--mx-space-1) 0;
}

.preview :global(.md-preview) table {
  border-collapse: collapse;
  margin: var(--mx-space-3) 0;
}

.preview :global(.md-preview) th,
.preview :global(.md-preview) td {
  border: 1px solid var(--mx-separator);
  padding: var(--mx-space-2) var(--mx-space-3);
  text-align: left;
}

.preview :global(.md-preview) hr {
  border: none;
  border-top: 1px solid var(--mx-separator);
  margin: var(--mx-space-3) 0;
}

.editArea {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

/* 插入元素工具栏：横排图标钮，超出横向滚动（Detail 面板窄空间兜底）；
   与编辑区之间以分隔线区隔 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: var(--mx-space-2);
  border-bottom: 1px solid var(--mx-separator);
}

.toolbar::-webkit-scrollbar {
  display: none;
}

.toolBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.toolBtn:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}

.toolBtn:active {
  background: var(--mx-hover);
  color: var(--mx-accent);
}

.toolBtn:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: 1px;
}
</style>
