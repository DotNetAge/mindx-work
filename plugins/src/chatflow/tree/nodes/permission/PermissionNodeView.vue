<script setup lang="ts">
// permission 节点展开态：授权详情（审计闭环的正文留痕，PR §2.2 族 3）。
// 名片（已授权/已拒绝 xxx）走统一名片，此处展示参数摘要 / 决定理由 / 安全级别 / 子会话路由。
// 源：mindx-desktop tree/nodes/permission/PermissionNodeView.vue（二期 B 平移）。
import type { PermissionNode } from '../../types/system'

defineProps<{ node: PermissionNode }>()

const DECISION_LABELS: Record<string, string> = {
  pending: '等待授权',
  granted: '已授权（本次）',
  'session-granted': '已授权（本会话内不再询问）',
  denied: '已拒绝',
}
</script>

<template>
  <div class="permission-detail">
    <div class="detail-row">
      <span class="row-label">授权决定</span>
      <span class="row-value" :class="{ denied: node.decision === 'denied' }">
        {{ DECISION_LABELS[node.decision] || node.decision }}
      </span>
    </div>
    <div class="detail-row">
      <span class="row-label">安全级别</span>
      <span class="row-value">{{ node.securityLevel }}</span>
    </div>
    <div v-if="node.paramsDigest" class="detail-row">
      <span class="row-label">参数</span>
      <span class="row-value mono">{{ node.paramsDigest }}</span>
    </div>
    <div v-if="node.reason" class="detail-row">
      <span class="row-label">理由</span>
      <span class="row-value">{{ node.reason }}</span>
    </div>
    <div v-if="node.sessionId" class="detail-row">
      <span class="row-label">子会话</span>
      <span class="row-value mono">{{ node.sessionId.slice(0, 8) }}</span>
    </div>
  </div>
</template>

<style scoped>
.permission-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.detail-row {
  display: flex;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  line-height: 1.6;
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
  min-width: 0;
}

.row-value.denied {
  color: var(--mx-danger);
}

.row-value.mono {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
}
</style>
