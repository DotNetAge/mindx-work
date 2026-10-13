<script setup lang="ts">
/**
 * 放置于 Sheet 的 Markdown 编辑器：由 openMarkdownSheet() 唤起，
 * 编辑目标（初始正文/占位/保存回调）经 sheetEditor 模块草稿态传入。
 * 编辑器主体复用 MarkdownEditorBody（工具栏 + CodeMirror），高宽撑满 Sheet 容器；
 * 保存按钮在工具栏右端，Sheet 本身可关闭（无取消按钮）。
 * 保存走 onSave 的 Promise：成功关闭 Sheet，失败保持打开留改。
 */
import { ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import MarkdownEditorBody from './MarkdownEditorBody.vue'
import { closeMarkdownSheet, sheetDraft } from './sheetEditor'

const shell = useShell()

/** 挂载时快照编辑目标（唤起先于渲染，必有值） */
const target = sheetDraft.value
const text = ref(target?.value ?? '')
const saving = ref(false)

async function save(): Promise<void> {
  if (!target || saving.value) return
  saving.value = true
  try {
    await target.onSave(text.value)
    closeMarkdownSheet(shell)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div :class="$style.editor">
    <MarkdownEditorBody
      v-if="target"
      :value="text"
      lang="md"
      :placeholder="target.placeholder"
      save-button
      :saving="saving"
      @update:value="text = $event"
      @save="save"
    />
  </div>
</template>

<style module>
.editor {
  /* 高宽撑满 Sheet 容器；壳未约束高度时以 60vh 兜底 */
  width: 100%;
  height: 100%;
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
