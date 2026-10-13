<script setup lang="ts">
/**
 * Markdown 编辑器主体（共用件）：插入元素工具栏 + CodeMirror 6 源码编辑。
 * DetailPanel（文件编辑）与 MarkdownEditorSheet（Sheet 内编辑）共用本组件，
 * 工具栏三类操作 = 包裹 / 行前缀 / 新块；Ctrl/Cmd+Enter 快捷保存（CodeMirrorPane 内置）。
 * saveButton 开启时在工具栏右端渲染「保存」按钮（Sheet 场景：Sheet 本身可关闭，无取消按钮）。
 */
import { ref } from 'vue'
import { CodeMirrorPane, MxIcon } from '@mindx-work/ui-shell-vue'

const props = defineProps<{
  value: string
  placeholder?: string
  lang?: string
  /** 工具栏右端渲染「保存」按钮（默认关：DetailPanel 头部已有保存入口） */
  saveButton?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:value': [value: string]
  save: []
}>()

// ── 插入元素工具栏：三类操作 = 包裹 / 行前缀 / 新块 ──────────────────────────
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
</script>

<template>
  <div :class="$style.body">
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
      <button
        v-if="props.saveButton"
        type="button"
        class="mx-btn mx-btn--primary"
        :class="$style.saveBtn"
        :disabled="props.saving"
        @click="emit('save')"
      >
        <span v-if="props.saving" class="mx-text-loading">保存中…</span>
        <template v-else>保存</template>
      </button>
    </div>
    <CodeMirrorPane
      ref="paneRef"
      :value="props.value"
      :lang="props.lang ?? 'md'"
      :placeholder="props.placeholder || '输入 Markdown 内容'"
      @update:value="emit('update:value', $event)"
      @save="emit('save')"
    />
  </div>
</template>

<style module>
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

/* 插入元素工具栏：横排图标钮，超出横向滚动（窄空间兜底）；保存钮推到右端；
   左右留白（Sheet 场景工具栏贴容器边缘） */
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 0 var(--mx-space-2) var(--mx-space-2);
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

.saveBtn {
  margin-left: auto;
  flex-shrink: 0;
}
</style>
