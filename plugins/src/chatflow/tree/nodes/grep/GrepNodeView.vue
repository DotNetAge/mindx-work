<script setup lang="ts">
// tool.grep 节点展开态：命中列表（共享 HitsList），行点击打开文件并定位行（file:line:text）。
import { computed } from 'vue'
import HitsList from '../shared/HitsList.vue'
import { parseHitRow, rowsFromTail } from '../shared/rows'
import { basename, tryOpenFile } from '../../../toolViewUtils'
import type { GrepToolNode } from '../../types/tool'

const props = defineProps<{ node: GrepToolNode }>()

const rows = computed(() => rowsFromTail(props.node.outputTail))

/** 命中行只显示「文件名:行号:内容」，全路径留在悬浮 title */
function nameOf(row: string): string {
  const hit = parseHitRow(row)
  if (!hit.file) return row
  const head = hit.line != null ? `${basename(hit.file)}:${hit.line}` : basename(hit.file)
  return hit.text ? `${head}:${hit.text}` : head
}

/** 行内文件图标路径提取：取命中行的 file 段 */
function pathOf(row: string): string {
  return parseHitRow(row).file || row.split(':')[0]!
}

/** 行点击：解析 file:line 定位打开；无行号形态直接打开文件 */
function openRow(row: string): void {
  const hit = parseHitRow(row)
  if (!hit.file) return
  if (hit.line != null) {
    void tryOpenFile(`${hit.file}:${hit.line}`)
  } else {
    void tryOpenFile(hit.file)
  }
}
</script>

<template>
  <div class="grep-detail">
    <div class="detail-pattern">
      <span class="pattern-text">{{ node.pattern }}</span>
      <span v-if="node.include" class="detail-hint">筛选 {{ node.include }}</span>
      <span v-if="node.mode" class="detail-hint">{{ node.mode }}</span>
    </div>
    <HitsList :items="rows" :name-of="nameOf" :path-of="pathOf" empty-text="无命中" @row-click="openRow" />
  </div>
</template>

<style scoped>
.grep-detail {
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
}
</style>
