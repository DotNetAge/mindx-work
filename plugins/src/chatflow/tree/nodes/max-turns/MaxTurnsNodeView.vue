<script setup lang="ts">
// max_turns 节点视图：包装 MaxTurnsWarning（进度环 + 建议文案）。
import MaxTurnsWarning from '../../../chatround/MaxTurnsWarning.vue'
import type { MaxTurnsNode } from '../../types/system'

defineProps<{ node: MaxTurnsNode }>()
</script>

<template>
  <MaxTurnsWarning
    :turns-completed="node.turnsCompleted"
    :max-turns="node.maxTurns"
    :suggestion="node.suggestion || ''"
  />
</template>
