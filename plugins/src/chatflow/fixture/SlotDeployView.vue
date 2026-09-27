<script setup lang="ts">
// 五期槽位验收视图：fixture 扩展注册的 standalone 贡献视图（语义同内建全卡直渲——
// 自带 header/折叠/正文，树壳不套统一名片）。
// 合规形态演示：仅消费贡献节点结构化字段（params / outputTail / status）与槽位公共
// 契约出口、壳 UI 原语（MxIcon），不 import ChatFlow 内部组件（共享件纪律）；
// 样式全量 --mx-* 语义 token（军规 3），data-slot-view 供 Playwright 渲染出口断言。
import { computed, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import type { ContributedToolNode } from '../slot'

const props = defineProps<{ node: ContributedToolNode }>()

const expanded = ref(true)

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

const service = computed(() => str(props.node.params.service))
const version = computed(() => str(props.node.params.version))
const target = computed(() => str(props.node.params.target))
const statusText = computed(() => (props.node.status === 'success' ? '部署成功' : props.node.status))
</script>

<template>
  <div class="slot-deploy" data-slot-view="tool.deploy">
    <div class="deploy-head" @click="expanded = !expanded">
      <MxIcon name="lucide:rocket" :size="16" class="deploy-icon" />
      <span class="deploy-title">部署 {{ service }}</span>
      <span v-if="version" class="badge version">{{ version }}</span>
      <span class="flex-spacer" />
      <span v-if="target" class="badge target">{{ target }}</span>
      <MxIcon name="lucide:chevron-right" :size="16" class="chevron" :class="{ open: expanded }" />
    </div>
    <el-collapse-transition>
      <div v-if="expanded" class="deploy-body">
        <div class="deploy-line">{{ node.toolName }} · {{ statusText }}</div>
        <pre v-if="node.outputTail" class="deploy-output">{{ node.outputTail }}</pre>
      </div>
    </el-collapse-transition>
  </div>
</template>

<style scoped>
.slot-deploy {
  min-width: 0;
}

.deploy-head {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-height: 28px;
  padding: 2px 0;
  cursor: pointer;
}

.deploy-icon {
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.deploy-title {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  min-width: 0;
}

.badge {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
}

.flex-spacer {
  flex: 1;
  min-width: 0;
}

.chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.chevron.open {
  transform: rotate(90deg);
}

.deploy-body {
  padding: var(--mx-space-1) 0 var(--mx-space-2) var(--mx-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.deploy-line {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.deploy-output {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
  background: var(--mx-bg-secondary);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-2);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
