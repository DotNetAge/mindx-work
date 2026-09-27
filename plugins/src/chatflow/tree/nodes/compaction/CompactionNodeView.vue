<script setup lang="ts">
// compaction 节点视图：包装 CompactionView（窗口占用条，PR §2.2 族 3）。
// sessionID 展示在现役组件是可选 tag，节点 payload 无此字段传空即可。
import CompactionView from '../../../chatround/CompactionView.vue'
import type { CompactionNode } from '../../types/system'

defineProps<{ node: CompactionNode }>()
</script>

<template>
  <CompactionView
    :session-i-d="''"
    :remaining-after="node.remainingAfter"
    :window-size="node.windowSize"
  />
</template>
