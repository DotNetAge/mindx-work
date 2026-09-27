<script setup lang="ts">
// tool.ls 节点展开态：目录条目列表（共享 HitsList，PR §3.2 共用列表组件）。
// 「在资源管理器中显示」由名片操作分派（reveal），列表行无点击行为。
import { computed } from 'vue'
import HitsList from '../shared/HitsList.vue'
import { rowsFromTail } from '../shared/rows'
import { basename } from '../../../toolViewUtils'
import type { LsToolNode } from '../../types/tool'

const props = defineProps<{ node: LsToolNode }>()

const rows = computed(() => rowsFromTail(props.node.outputTail))

/** 列表只显示条目名（根本显示不完全路径），全路径留在悬浮 title */
const nameOf = (row: string): string => basename(row.trim())
</script>

<template>
  <div class="ls-detail">
    <el-tooltip :content="node.path" placement="top" :hide-after="0">
      <div class="detail-path">
        {{ node.path }}<span v-if="node.recursive" class="detail-hint">（递归）</span>
      </div>
    </el-tooltip>
    <HitsList :items="rows" :name-of="nameOf" :path-of="(r) => r" empty-text="目录为空或条目超出保留范围" />
  </div>
</template>

<style scoped>
.ls-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.detail-path {
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-hint {
  color: var(--mx-text-tertiary);
}
</style>
