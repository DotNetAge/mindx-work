<script setup lang="ts">
/**
 * codeeditor 详情面板：头部（文件名 + 脏标记 + 保存）+ CodeMirror 6 编辑主体。
 * 语言按当前文件扩展名经共享内核 CodeMirrorPane 映射（未知扩展 = 纯文本）；
 * Cmd/Ctrl+S 由 CodeMirrorPane 内建 keymap 上抛 save，全局兜底同 markdown 面板。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { CodeMirrorPane, MxIcon } from '@mindx-work/ui-shell-vue'
import { useCodeEditorStore } from './store'

const store = useCodeEditorStore()

/** 文件名（basename） */
const fileName = computed(() => store.currentFile.split('/').pop() || store.currentFile)

/** 扩展名 → CodeMirror 语言映射键（无扩展名传空 = 纯文本） */
const lang = computed(() => {
  const name = fileName.value
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
})

// ── Cmd/Ctrl+S 全局兜底（焦点不在编辑器内时仍可保存）────────────────────────
function onKeydown(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
  if (!store.dirty) return
  e.preventDefault()
  void store.save()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div :class="$style.panel">
    <!-- 头部：文件名 + 脏点 + 保存 -->
    <div :class="$style.header">
      <span :class="$style.fileName" :title="store.currentFile">
        <MxIcon name="lucide:file-code" :size="16" />
        {{ fileName || '未打开文件' }}
        <span v-if="store.dirty" :class="$style.dot" aria-label="未保存"></span>
      </span>
      <button
        v-if="store.dirty"
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
    <p v-if="!store.currentFile" :class="$style.hint">尚未打开任何代码文件</p>

    <!-- 错误态（打开失败反馈） -->
    <p v-else-if="store.error" :class="$style.error">{{ store.error }}</p>

    <!-- 编辑主体：CodeMirror 6（按扩展名语法高亮） -->
    <CodeMirrorPane
      v-else
      :value="store.code"
      :lang="lang"
      @update:value="store.setCode"
      @save="store.save()"
    />
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
</style>
