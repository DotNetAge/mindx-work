<script setup lang="ts">
// tool.team_ops 节点展开态：结果摘要（PR 对照表「结果摘要」）。
// 结果文本 = outputTail，纯文本行展示（团队列表/任务列表等）。
import { computed } from 'vue'
import { rowsFromTail } from '../shared/rows'
import type { TeamOpsToolNode } from '../../types/tool'

const props = defineProps<{ node: TeamOpsToolNode }>()

const rows = computed(() => rowsFromTail(props.node.outputTail))
</script>

<template>
  <div class="teamops-detail">
    <div v-if="rows.length" class="digest-rows">
      <div v-for="(row, i) in rows" :key="i" class="digest-row">{{ row }}</div>
    </div>
    <div v-else class="detail-empty">无结果数据</div>
  </div>
</template>

<style scoped>
.teamops-detail {
  padding: var(--mx-space-1) 0;
}

.digest-rows {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-secondary);
  max-height: 280px;
  overflow-y: auto;
}

.digest-row {
  padding: 1px 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.detail-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
