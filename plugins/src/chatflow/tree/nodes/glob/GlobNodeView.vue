<script setup lang="ts">
// tool.glob 节点展开态：匹配文件列表（共享 HitsList）；行点击打开对应文件。
import { computed } from 'vue'
import HitsList from '../shared/HitsList.vue'
import { rowsFromTail } from '../shared/rows'
import { basename, tryOpenFile } from '../../../toolViewUtils'
import type { GlobToolNode } from '../../types/tool'

const props = defineProps<{ node: GlobToolNode }>()

const rows = computed(() => rowsFromTail(props.node.outputTail))

/** 列表只显示文件名（根本显示不完全路径），全路径留在悬浮 title */
const nameOf = (row: string): string => basename(row.trim())

/** 行点击：命中行多为相对路径，tryOpenFile 内部做候选解析逐个探测打开 */
function openRow(row: string): void {
  const raw = row.trim()
  if (raw) void tryOpenFile(raw)
}
</script>

<template>
  <div class="glob-detail">
    <div class="detail-pattern">
      <span class="pattern-text">{{ node.pattern }}</span>
      <el-tooltip v-if="node.path" :content="node.path" placement="top" :hide-after="0">
        <span class="detail-hint">于 {{ node.path }}</span>
      </el-tooltip>
    </div>
    <HitsList :items="rows" :name-of="nameOf" :path-of="(r) => r" empty-text="无匹配文件" @row-click="openRow" />
  </div>
</template>

<style scoped>
.glob-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.detail-pattern {
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-2);
}

.pattern-text {
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.detail-hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
