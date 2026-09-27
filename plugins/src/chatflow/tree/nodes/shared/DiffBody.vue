<script setup lang="ts">
// 共享 diff 渲染体（tool.write / tool.edit 展开态共用）：
// 解析 unified diff 文本，按 +/- 行着色逐行渲染。
// diff 文本来源 = 节点 outputTail 的结果 JSON（toolViewUtils.extractDiff 兼容多形态字段），
// 结构化统计（±行数徽标）走名片，此处只做审计回看的 diff 呈现。
import { computed } from 'vue'
import { extractDiff, parseToolResult } from '../../../toolViewUtils'

const props = defineProps<{
  /** 工具结果文本尾段（builder 截取，节点字段非原始事件） */
  outputTail?: string
}>()

const diffText = computed(() => extractDiff(parseToolResult(props.outputTail || '')))

interface DiffLine {
  kind: 'add' | 'del' | 'hunk' | 'ctx'
  text: string
}

const lines = computed<DiffLine[]>(() => {
  if (!diffText.value) return []
  return diffText.value.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '').map(line => {
    if (line.startsWith('@@')) return { kind: 'hunk', text: line }
    if (line.startsWith('+') && !line.startsWith('+++')) return { kind: 'add', text: line }
    if (line.startsWith('-') && !line.startsWith('---')) return { kind: 'del', text: line }
    return { kind: 'ctx', text: line }
  })
})
</script>

<template>
  <div v-if="lines.length" class="diff-body">
    <div
      v-for="(ln, i) in lines"
      :key="i"
      class="diff-line"
      :class="ln.kind"
    >{{ ln.text }}</div>
  </div>
  <div v-else class="diff-empty">diff 内容不可用（结果超出保留范围或已确认合入）</div>
</template>

<style scoped>
/* 平铺样式：去外框，保留 diff 行红绿底色 */
.diff-body {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  line-height: 1.6;
}

.diff-line {
  padding: 0 var(--mx-space-2);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--mx-text-secondary);
}

.diff-line.add {
  color: var(--mx-success);
  background: color-mix(in srgb, var(--mx-success) 10%, transparent);
}

.diff-line.del {
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
}

.diff-line.hunk {
  color: var(--mx-text-tertiary);
  background: color-mix(in srgb, var(--mx-text-tertiary) 10%, transparent);
}

.diff-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}
</style>
