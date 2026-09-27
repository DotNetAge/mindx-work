<script setup lang="ts">
// error 节点视图：包装 ErrorView（阻断节点，重试/忽略/打开设置三操作就位）。
// 事件上抛给树壳 → ChatRound → 现役重试链路（PR §4.1，四期接线）。
import ErrorView from '../../../chatround/ErrorView.vue'
import type { ErrorNode } from '../../types/system'

const props = defineProps<{ node: ErrorNode }>()

const emit = defineEmits<{
  (e: 'retry'): void
  (e: 'dismiss'): void
  (e: 'open-settings'): void
}>()

// 恢复策略可重试（与现役一致：可恢复错误才显示重试按钮）
const isRecoverable = props.node.source !== 'provider_402'
</script>

<template>
  <ErrorView
    :message="node.message"
    :code="node.httpClass || ''"
    :details="node.details || ''"
    :is-recoverable="isRecoverable"
    :http-class="node.httpClass || ''"
    @retry="emit('retry')"
    @dismiss="emit('dismiss')"
    @open-settings="emit('open-settings')"
  />
</template>
