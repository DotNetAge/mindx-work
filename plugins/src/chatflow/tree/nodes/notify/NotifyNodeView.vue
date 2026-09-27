<script setup lang="ts">
// tool.notify 节点展开态：系统通知内容（title/message/subtitle 结构化字段直渲）。
import type { NotifyToolNode } from '../../types/tool'

defineProps<{ node: NotifyToolNode }>()
</script>

<template>
  <div class="notify-detail">
    <div v-if="node.subtitle" class="notify-subtitle">{{ node.subtitle }}</div>
    <div v-if="node.message" class="notify-message">{{ node.message }}</div>
    <div v-if="!node.message && !node.subtitle" class="detail-empty">无通知内容</div>
  </div>
</template>

<style scoped>
.notify-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.notify-subtitle {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.notify-message {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
