<script setup lang="ts">
// task 实体卡展开态：upsert 时刻的看板快照 + 状态流转审计（PR §2.2 族 2）。
// 快照是节点 payload（checklistSnapshot），不读 store 实时看板——历史轮回看时
// 看板早已变化，快照才是该时点的真实布局（可审计性北极星）。
// 源：mindx-desktop tree/nodes/task/TaskNodeView.vue（二期 B 平移）。
import { computed } from 'vue'
import type { TaskNode } from '../../types/entity'

const props = defineProps<{ node: TaskNode }>()

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}

function label(s: string): string {
  return STATUS_LABELS[s] || s
}

const snapshot = computed(() => props.node.checklistSnapshot || [])

const transitions = computed(() =>
  [...props.node.transitions].sort((a, b) => a.at - b.at)
)

function formatClock(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
</script>

<template>
  <div class="task-detail">
    <!-- 看板快照（upsert 时点） -->
    <div v-if="snapshot.length" class="snapshot-section">
      <div class="section-label">快照（{{ snapshot.length }} 项）</div>
      <div
        v-for="item in snapshot"
        :key="item.taskId"
        class="snapshot-row"
        :class="{ current: item.taskId === node.taskId }"
      >
        <span class="row-status" :class="item.status">{{ label(item.status) }}</span>
        <span class="row-subject">{{ item.subject }}</span>
      </div>
    </div>

    <!-- 状态流转审计 -->
    <div v-if="transitions.length" class="transition-section">
      <div class="section-label">状态流转</div>
      <div v-for="(tr, i) in transitions" :key="i" class="transition-row">
        <span class="tr-time">{{ formatClock(tr.at) }}</span>
        <span class="tr-arrow">→</span>
        <span class="tr-status" :class="tr.status">{{ label(tr.status) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) 0;
}

.section-label {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin-bottom: var(--mx-space-1);
}

.snapshot-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: 2px 0;
  font: var(--mx-font-caption);
}

.snapshot-row.current .row-subject {
  color: var(--mx-text);
  font-weight: 600;
}

.row-subject {
  color: var(--mx-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 平铺样式：状态徽标去底色块，语义色只作文字色 */
.row-status,
.tr-status {
  flex-shrink: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.row-status.in_progress,
.tr-status.in_progress {
  color: var(--mx-accent);
}

.row-status.completed,
.tr-status.completed {
  /* 完成不是高亮事件：走中性第二色（树内成功态统一灰） */
  color: var(--mx-text-secondary);
}

.row-status.cancelled,
.tr-status.cancelled {
  color: var(--mx-danger);
}

.transition-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  padding: 1px 0;
}

.tr-time {
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
}

.tr-arrow {
  color: var(--mx-text-tertiary);
}
</style>
