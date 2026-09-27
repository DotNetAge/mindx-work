<script setup lang="ts">
// PendingRow —— 树尾 ephemeral 指示行（PR §3.4）。
// 轮 executing 但当前无任何 executing 节点（LLM 建流空窗、首 token 前）时由 TreeView
// 在树尾渲染：不入树数据、不持久化，轮结束消失（现役顶部摘要行的残余职责）。
// 文案与 executing 名片共用同一措辞来源（registry/summary.ts 常量）。
import { MxIcon } from '@mindx-work/ui-shell-vue'

defineProps<{ label: string }>()
</script>

<template>
  <div class="pending-row">
    <MxIcon name="lucide:loader-circle" :size="16" class="pending-spinner spin" />
    <span class="shimmer-text">{{ label }}</span>
  </div>
</template>

<style scoped>
.pending-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  color: var(--mx-text-secondary);
  font: var(--mx-font-caption);
}

.pending-spinner {
  color: var(--mx-accent);
}

.spin {
  animation: pending-spin 1.2s linear infinite;
}

@keyframes pending-spin {
  to { transform: rotate(360deg); }
}
</style>
