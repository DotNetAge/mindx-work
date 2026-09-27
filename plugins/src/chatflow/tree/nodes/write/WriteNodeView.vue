<script setup lang="ts">
// tool.write 节点展开态（参考形态）：文件行 = 语言徽标 + 文件名 + 增删统计，零按钮零 chevron。
// 点击文件行打开原生 diff（open-diff 经 NodeCard 上抛分派）；写入类型/字节收 title 悬浮。
import { computed } from 'vue'
import LangBadge from '../shared/LangBadge.vue'
import { basename } from '../../../toolViewUtils'
import type { WriteToolNode } from '../../types/tool'

const props = defineProps<{ node: WriteToolNode }>()

const emit = defineEmits<{ (e: 'open-diff'): void }>()

const WRITE_TYPE_LABELS: Record<string, string> = {
  create: '新建文件',
  overwrite: '覆盖写入',
  append: '追加写入',
}

// 悬浮信息：全路径 + 写入类型 + 字节数（不占视觉空间）
const metaTitle = computed(() => {
  const parts: string[] = [props.node.filePath]
  if (props.node.writeType) parts.push(WRITE_TYPE_LABELS[props.node.writeType] || props.node.writeType)
  if (props.node.bytesWritten) parts.push(`${props.node.bytesWritten} 字节`)
  return parts.join('\n')
})
</script>

<template>
  <div class="write-detail">
    <el-tooltip :content="metaTitle" placement="top" :hide-after="0">
      <div class="file-row" @click="emit('open-diff')">
        <LangBadge :path="node.filePath" />
        <span class="file-name">{{ basename(node.filePath) || node.filePath }}</span>
        <span v-if="node.additions != null" class="stat-add">+{{ node.additions }}</span>
        <span v-if="node.deletions != null" class="stat-del">-{{ node.deletions }}</span>
      </div>
    </el-tooltip>
  </div>
</template>

<style scoped>
.write-detail {
  padding: var(--mx-space-1) 0;
}

.file-row {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-height: 22px;
  padding: 2px 0;
  cursor: pointer;
  user-select: none;
  max-width: 100%;
}

.file-name {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-add {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-success);
  flex-shrink: 0;
}

.stat-del {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-danger);
  flex-shrink: 0;
}
</style>
