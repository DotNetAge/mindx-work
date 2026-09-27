<script setup lang="ts">
// tool.task_query 节点展开态：TaskListView 嵌入模式（只读看板，PR 对照表「TaskListView 只读」）。
// desktop 直接读 chatStore 实时看板；work 数据层四期才接，TaskListView 已改 props 注入，
// TaskQueryToolNode 亦无看板快照字段——本期传空看板（空态「暂无任务」），
// 四期接线时由调用方从 ChatFlow store 供看板快照。
import TaskListView from '../../../chatround/TaskListView.vue'
import type { TaskQueryToolNode } from '../../types/tool'

defineProps<{ node: TaskQueryToolNode }>()
</script>

<template>
  <div class="taskquery-detail">
    <TaskListView :tasks="[]" />
  </div>
</template>

<style scoped>
.taskquery-detail {
  padding: var(--mx-space-1) 0;
}
</style>
