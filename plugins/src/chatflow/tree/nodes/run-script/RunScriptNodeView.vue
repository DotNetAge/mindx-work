<script setup lang="ts">
// tool.run_script 节点展开态：包装 BashTerminalView（与 bash 同形态，PR 对照表）。
// 展示脚本命令正文；skillName 标注来源技能，「打开 SKILL 目录」走名片操作分派。
import { computed } from 'vue'
import BashTerminalView from '../../../chatround/BashTerminalView.vue'
import type { RunScriptToolNode } from '../../types/tool'

const props = defineProps<{ node: RunScriptToolNode }>()

const scriptText = computed(() =>
  [props.node.script, props.node.args].filter(Boolean).join(' ')
)

const terminalStatus = computed<'executing' | 'done' | 'failed'>(() => {
  if (props.node.status === 'executing') return 'executing'
  if (props.node.status === 'failed') return 'failed'
  return 'done'
})
</script>

<template>
  <div class="runscript-node">
    <div v-if="node.skillName" class="skill-hint">SKILL: {{ node.skillName }}</div>
    <BashTerminalView
      :start="{ params: { command: scriptText } }"
      :end="{ result: node.outputTail || '' }"
      :status="terminalStatus"
    />
  </div>
</template>

<style scoped>
.runscript-node {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.skill-hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
