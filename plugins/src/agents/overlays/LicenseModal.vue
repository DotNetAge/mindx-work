<script setup lang="ts">
/**
 * 许可证阅读 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 文案取挂载时的待阅读快照（modal 每次打开重新挂载）；仅展示，无动作副作用。
 */
import { useShell } from '@mindx-work/ui-shell-vue'
import { useAgentsStore } from '../store'
import { MODAL_AGENTS_LICENSE } from '../ids'

const store = useAgentsStore()
const shell = useShell()

function close(): void {
  shell.Overlay.remove(MODAL_AGENTS_LICENSE)
}
</script>

<template>
  <div v-if="store.license" :class="$style.body">
    <span :class="$style.title">{{ store.license.title }}</span>
    <pre :class="$style.content">{{ store.license.content || '（未声明许可证内容）' }}</pre>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">关闭</button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  min-width: 0;
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.content {
  margin: 0;
  max-height: 50vh;
  overflow-y: auto;
  font-family: var(--mx-font-family);
  font-size: var(--mx-font-caption);
  line-height: 1.6;
  color: var(--mx-text-secondary);
  background: var(--mx-module);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-3);
  white-space: pre-wrap;
  word-break: break-word;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
