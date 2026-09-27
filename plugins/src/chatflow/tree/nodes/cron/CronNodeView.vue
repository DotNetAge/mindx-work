<script setup lang="ts">
// tool.cron 节点展开态：定时任务详情行（PR 对照表「cron 详情」）。
// 「打开定时任务」操作（open-schedule → ScheduleView）走名片操作分派。
import type { CronToolNode } from '../../types/tool'

defineProps<{ node: CronToolNode }>()
</script>

<template>
  <div class="cron-detail">
    <div class="detail-row">
      <span class="row-label">动作</span>
      <span class="row-value">{{ node.action || '—' }}</span>
    </div>
    <div v-if="node.cronId" class="detail-row">
      <span class="row-label">任务 ID</span>
      <span class="row-value mono">{{ node.cronId }}</span>
    </div>
    <div v-if="node.agent" class="detail-row">
      <span class="row-label">Agent</span>
      <span class="row-value">{{ node.agent }}</span>
    </div>
    <div v-if="node.cronExpr" class="detail-row">
      <span class="row-label">周期</span>
      <span class="row-value mono">{{ node.cronExpr }}</span>
    </div>
    <div v-if="node.enabled != null" class="detail-row">
      <span class="row-label">状态</span>
      <span class="row-value" :class="{ off: node.enabled === false }">{{ node.enabled ? '已启用' : '已停用' }}</span>
    </div>
  </div>
</template>

<style scoped>
.cron-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.detail-row {
  display: flex;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
}

.row-label {
  flex-shrink: 0;
  width: 64px;
  color: var(--mx-text-tertiary);
  font: var(--mx-font-caption);
  line-height: inherit;
}

.row-value {
  color: var(--mx-text-secondary);
  word-break: break-word;
}

.row-value.mono {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
}

.row-value.off {
  color: var(--mx-warning);
}
</style>
