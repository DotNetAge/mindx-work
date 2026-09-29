<script setup lang="ts">
/**
 * CodeMirrorPane：CodeMirror 6 编辑器共享封装（markdown / codeeditor 插件共用内核）。
 * v-model:value 双向 + Cmd/Ctrl+S 上抛 save；语言按扩展名经 Compartment 动态切换。
 * 主题全部走壳 CSS 变量（禁止硬编码颜色，与工作台主题一致）；工具栏命令
 * wrapSelection（选中包裹）/ insertBlock（行首插块）经 defineExpose 供面板调用。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  placeholder,
} from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { closeBrackets } from '@codemirror/autocomplete'
import { languageFor } from '../codemirror'

const props = defineProps<{
  /** 编辑内容（v-model:value） */
  value: string
  /** 文件扩展名（决定语法高亮语言；未知扩展 = 纯文本） */
  lang: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:value', value: string): void
  (e: 'save'): void
}>()

const hostRef = ref<HTMLElement | null>(null)
const langCompartment = new Compartment()
let view: EditorView | null = null

/** Cmd/Ctrl+S 上抛（编辑器内焦点时优先于全局快捷键） */
const saveKeymap = {
  key: 'Mod-s',
  run: () => {
    emit('save')
    return true
  },
}

/** 主题：全部壳 CSS 变量，零硬编码颜色；字号随通用设置 --mx-font-body（14px/22px） */
const theme = EditorView.theme({
  '&': {
    color: 'var(--mx-text)',
    backgroundColor: 'transparent',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--mx-font-mono)',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--mx-accent)',
    font: 'var(--mx-font-body)',
    fontFamily: 'var(--mx-font-mono)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--mx-accent)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--mx-text-caption)',
    border: 'none',
    borderRight: '1px solid var(--mx-separator)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--mx-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--mx-hover)', color: 'var(--mx-text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--mx-accent) 25%, transparent) !important',
  },
  '.cm-placeholder': { color: 'var(--mx-text-caption)' },
})

/** 语法高亮：颜色全部走 --mx-cm-* 主题变量（亮/暗两套，tokens.css 定义），自动跟随主题 */
const highlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--mx-cm-heading)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--mx-cm-link)' },
  { tag: [tags.keyword, tags.modifier], color: 'var(--mx-cm-keyword)' },
  { tag: tags.string, color: 'var(--mx-cm-string)' },
  { tag: tags.comment, color: 'var(--mx-cm-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--mx-cm-number)' },
  { tag: tags.meta, color: 'var(--mx-cm-meta)' },
])

/** 内容变化上抛（外部输入驱动） */
const updateListener = EditorView.updateListener.of((update) => {
  if (update.docChanged) emit('update:value', update.state.doc.toString())
})

onMounted(() => {
  if (!hostRef.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: props.value,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        syntaxHighlighting(highlight),
        keymap.of([saveKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        langCompartment.of(languageFor(props.lang)),
        EditorView.lineWrapping,
        props.placeholder ? placeholder(props.placeholder) : [],
        theme,
        updateListener,
      ],
    }),
    parent: hostRef.value,
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

// 外部 value 变更同步进编辑器（打开新文件 / 磁盘回读），跳过自身回环
watch(
  () => props.value,
  (next) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (next !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: next } })
    }
  },
)

// 语言动态切换（打开不同扩展名文件时组件复用）
watch(
  () => props.lang,
  (next) => {
    view?.dispatch({ effects: langCompartment.reconfigure(languageFor(next)) })
  },
)

/** 选中内容包裹（粗体/斜体/行内代码等）：无选中时插入一对并居中 */
function wrapSelection(before: string, after: string = before): void {
  if (!view) return
  const sel = view.state.selection.main
  const text = view.state.sliceDoc(sel.from, sel.to)
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: before + text + after },
    selection: { anchor: sel.from + before.length, head: sel.from + before.length + text.length },
  })
  view.focus()
}

/** 行首插入前缀（标题/引用/列表）：光标所在行行首 */
function insertLinePrefix(prefix: string): void {
  if (!view) return
  const pos = view.state.selection.main.to
  const line = view.state.doc.lineAt(pos)
  view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } })
  view.focus()
}

/** 行首插入块（代码块/表格/图片/分割线）：当前行非空则另起一行 */
function insertBlock(text: string): void {
  if (!view) return
  const pos = view.state.selection.main.to
  const line = view.state.doc.lineAt(pos)
  const prefix = line.text.trim() === '' ? '' : '\n'
  view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix + text } })
  view.focus()
}

function focus(): void {
  view?.focus()
}

defineExpose({ wrapSelection, insertLinePrefix, insertBlock, focus })
</script>

<template>
  <div ref="hostRef" :class="$style.host"></div>
</template>

<style module>
.host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: transparent;
  display: flex;
  flex-direction: column;
}

.host :global(.cm-editor) {
  height: 100%;
}
</style>
