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

// ── frontmatter：剥离 + 解析 + 表格化渲染 ────────────────────────────────────
interface FmField {
  key: string
  value: string
}

/** HTML 转义（键值均为不可信文本，先转义再过 DOMPurify 双保险） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 提取并解析文档顶部的 frontmatter 块（仅首行 --- 起始的块，正文中的 --- 不受影响）。
 * 支持单层键值与 `- ` 列表值（拼顿号串）；嵌套 YAML 不引解析器依赖，行原样拼接。
 * 无 frontmatter 时 body 即原文。
 */
function parseFrontmatter(text: string): { fields: FmField[]; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!m) return { fields: [], body: text }

  const fields: FmField[] = []
  let curKey = ''
  const lines = (m[1] ?? '').split(/\r?\n/)
  for (const line of lines) {
    // 列表项行：归并到当前键，顿号串接
    const item = line.match(/^\s*-\s+(.*)$/)
    if (item && curKey) {
      const f = fields[fields.length - 1]
      const itemText = item[1]?.trim() ?? ''
      if (f) f.value = f.value ? `${f.value}、${itemText}` : itemText
      continue
    }
    const kv = line.match(/^([^\s:][^:]*):\s*(.*)$/)
    if (kv) {
      curKey = kv[1]?.trim() ?? ''
      fields.push({ key: curKey, value: kv[2]?.trim() ?? '' })
    } else if (curKey && line.trim()) {
      // 折行续体：追加到当前键值（嵌套 YAML 的降级处理）
      const f = fields[fields.length - 1]
      if (f) f.value += (f.value ? ' ' : '') + line.trim()
    }
  }
  return { fields: fields.filter((f) => f.key), body: text.slice(m[0].length) }
}

/** frontmatter → 键值表 HTML（空值显示占位符，与价格「￥0」同语义） */
function fmTableHtml(fields: FmField[]): string {
  const rows = fields
    .map(
      (f) =>
        `<tr><th>${escapeHtml(f.key)}</th><td>${escapeHtml(f.value) || '<span class="fm-empty">—</span>'}</td></tr>`,
    )
    .join('')
  return `<table class="fm-table">${rows}</table>`
}

/** markdown → 安全 HTML（gfm + 换行转义，与对话流同参数；frontmatter 表格化置顶） */
const renderedHtml = computed(() => {
  if (store.mode !== 'preview') return ''
  const { fields, body } = parseFrontmatter(store.draft)
  const raw = (fields.length > 0 ? fmTableHtml(fields) : '') + marked.parse(body, { gfm: true, breaks: true, async: false }) as string
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

/* frontmatter 卡片：带边框圆角矩形，微弱底色与正文区隔；键列弱色右对齐。
   必须 separate 模式——collapse 下 Chrome 不渲染表格自身圆角 */
.preview :global(.md-preview .fm-table) {
  border-collapse: separate;
  border-spacing: 0;
  margin: 0 0 var(--mx-space-4);
  font-size: 12px;
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-accent) 3%, transparent);
  overflow: hidden;
  box-shadow: 0 1px 2px color-mix(in srgb, black 4%, transparent);
}
.preview :global(.md-preview .fm-table) th {
  color: var(--mx-text-tertiary);
  font-weight: 600;
  text-align: right;
  padding: var(--mx-space-2) var(--mx-space-3) var(--mx-space-2) 0;
  border: none;
  white-space: nowrap;
  vertical-align: top;
}
.preview :global(.md-preview .fm-table) td {
  color: var(--mx-text);
  /* 值列取正文底色：与卡片微弱底色形成左右分栏对比，键值一眼区分 */
  background: var(--mx-bg-surface);
  padding: var(--mx-space-2) var(--mx-space-4) var(--mx-space-2) var(--mx-space-3);
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--mx-separator) 55%, transparent);
  word-break: break-word;
}
.preview :global(.md-preview .fm-table) th:first-child {
  padding-left: var(--mx-space-4);
}
.preview :global(.md-preview .fm-table) tr:last-child td {
  border-bottom: none;
}
.preview :global(.md-preview .fm-table) .fm-empty {
  color: var(--mx-text-tertiary);
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
