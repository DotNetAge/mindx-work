<script setup lang="ts">
// llm_retry 节点视图：包装 LLMRetryWarning（倒计时 + 重试序号）。
// 现役组件退避参数口径是纳秒（retryAfterNs），节点 payload 是毫秒，换算回传。
import LLMRetryWarning from '../../../chatround/LLMRetryWarning.vue'
import type { LlmRetryNode } from '../../types/system'

defineProps<{ node: LlmRetryNode }>()
</script>

<template>
  <LLMRetryWarning
    :provider="node.provider"
    :attempt="node.attempt"
    :max-attempts="node.maxAttempts"
    :retry-after-ns="(node.retryAfterMs || 0) * 1e6"
    :status-code="node.statusCode || 0"
  />
</template>
