<script setup lang="ts">
// tool.bash 节点展开态：黑底白字终端风格（--mx-terminal-* 对齐 workbench 终端配色，
// 与集成终端观感一致，参考形态）。输出显示解析自结果 JSON 的 stdout/stderr，
// 不 dump 原始 JSON（PR 展示约束：结构化供给 ≠ 全量显示）。
// 节点是唯一数据源，不回读原始事件（PR §2.1 边界约束）。
import { computed } from 'vue'
import { parseToolResult } from '../../../toolViewUtils'
import type { BashToolNode } from '../../types/tool'

const props = defineProps<{ node: BashToolNode }>()

// 多行命令按行拆分：每行一个 $ 前缀行
const cmdLines = computed(() => props.node.command.split('\n'))

// 结果侧是 JSON（exit_code/stdout/stderr/…）：解析取 stdout/stderr 分流显示，
// 解析失败（超长被尾截等）降级原文展示
const parsed = computed(() => parseToolResult(props.node.outputTail))
const stdoutText = computed(() => {
  if (parsed.value) return String(parsed.value.stdout ?? '').trimEnd()
  return (props.node.outputTail || '').trimEnd()
})
const stderrText = computed(() => {
  const s = parsed.value ? String(parsed.value.stderr ?? '') : ''
  return s.trim() ? s.trimEnd() : ''
})
</script>

<template>
  <div class="bash-shell">
    <div class="cmd-block">
      <div v-for="(line, i) in cmdLines" :key="i" class="cmd-line">
        <span class="prompt">$</span> {{ line }}
      </div>
    </div>
    <pre v-if="stdoutText" class="output-block">{{ stdoutText }}</pre>
    <pre v-if="stderrText" class="output-block stderr">{{ stderrText }}</pre>
    <div v-if="node.status === 'failed' && node.exitCode != null" class="exit-line">exit {{ node.exitCode }}</div>
  </div>
</template>

<style scoped>
/* 黑底白字终端：底色/前景/提示符取自 --mx-terminal-* token（对齐 workbench 终端配色），
   与集成终端（monaco-vscode-api）观感一致 */
.bash-shell {
  margin: var(--mx-space-1) 0 var(--mx-space-2);
  padding: var(--mx-space-3);
  background: var(--mx-terminal-bg);
  border: 1px solid color-mix(in srgb, var(--mx-terminal-fg) 15%, transparent);
  border-radius: var(--mx-radius-control);
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-caption);
  line-height: 1.7;
  color: var(--mx-terminal-fg);
  overflow-x: auto;
}

.prompt {
  color: var(--mx-terminal-cursor);
  font-weight: 600;
  user-select: none;
}

.cmd-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.output-block {
  margin: var(--mx-space-2) 0 0;
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-caption);
  color: var(--mx-terminal-fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.output-block.stderr,
.exit-line {
  margin-top: var(--mx-space-2);
  color: var(--mx-danger);
}
</style>
