<script setup lang="ts">
// cancelled 节点视图：用户中断一行卡（无展开态，PR §2.2 族 3）。
// 名片已承载「已中断 + 时长」，本视图仅提供展开态下的详情行（保持树壳渲染管线统一）。
import { computed } from 'vue'
import { formatDuration } from '../../../toolViewUtils'
import type { CancelledNode } from '../../types/system'

const props = defineProps<{ node: CancelledNode }>()

const elapsedText = computed(() =>
  props.node.elapsedMs ? `中断前已执行 ${formatDuration(props.node.elapsedMs)}` : '执行被用户中断'
)
</script>

<template>
  <div class="cancelled-detail">{{ elapsedText }}</div>
</template>

<style scoped>
.cancelled-detail {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-1) 0;
}
</style>
