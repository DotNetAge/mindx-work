<script setup lang="ts">
// tool.edit 节点展开态（参考形态）：文件行 = 语言徽标 + 文件名 + 增删统计，零按钮零 chevron。
// 点击文件行打开原生 diff（open-diff 经 NodeCard 上抛分派）；元信息收 title 悬浮。
import { computed } from 'vue'
import LangBadge from '../shared/LangBadge.vue'
import { basename } from '../../../toolViewUtils'
import type { EditToolNode } from '../../types/tool'

const props = defineProps<{ node: EditToolNode }>()

const emit = defineEmits<{ (e: 'open-diff'): void }>()

// 悬浮信息：全路径 + 替换明细（不占视觉空间）
const metaTitle = computed(() => {
  const parts: string[] = [props.node.filePath]
  if (props.node.replaceCount != null) parts.push(`替换 ${props.node.replaceCount} 处`)
  if (props.node.replaceMode) parts.push(props.node.replaceMode)
  return parts.join('\n')
})
</script>

<template>
  <div class="edit-detail">
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
.edit-detail {
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
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-caption);
  color: var(--mx-success);
  flex-shrink: 0;
}

.stat-del {
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-caption);
  color: var(--mx-danger);
  flex-shrink: 0;
}
</style>
