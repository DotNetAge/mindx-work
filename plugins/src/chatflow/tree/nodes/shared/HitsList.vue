<script setup lang="ts">
// 共享命中列表（tool.ls / tool.glob / tool.grep 展开态共用，PR §3.2 最小新增集合）：
// 逐行渲染文本命中，行点击交给使用方注入的处理器（打开文件 / 定位 / reveal）。
// 数据源 = 节点 outputTail（builder 截取的结果尾段），逐行拆分为列表；
// JSON 形态结果由使用方先行归一为行数组，本组件不解析结构。
import LangBadge from './LangBadge.vue'

defineProps<{
  /** 命中行文本数组（调用方从 outputTail 归一） */
  items: string[]
  /** 空态提示（无命中 / 数据不可用） */
  emptyText?: string
  /** 行点击回调（如打开命中文件） */
  onRowClick?: (row: string) => void
  /** 行显示名（可选）：只显示文件名等短形态，原始行（全路径）仍留在悬浮 title */
  nameOf?: (row: string) => string
  /** 行内文件路径提取（可选）：提供时行首展示文件类型图标（vscode 图标主题） */
  pathOf?: (row: string) => string
}>()
</script>

<template>
  <div v-if="items.length" class="hits-list">
    <el-tooltip v-for="(row, i) in items" :key="i" :content="row" placement="top" :hide-after="0">
      <div
        class="hit-row"
        :class="{ clickable: !!onRowClick }"
        @click="onRowClick?.(row)"
      ><LangBadge v-if="pathOf" :path="pathOf(row)" size="sm" class="hit-icon" />{{ nameOf ? nameOf(row) : row }}</div>
    </el-tooltip>
  </div>
  <div v-else class="hits-empty">{{ emptyText || '无命中' }}</div>
</template>

<style scoped>
/* 平铺样式：去外框，条目行保留 */
.hits-list {
  max-height: 280px;
  overflow-y: auto;
}

.hit-row {
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-1);
  font-family: var(--mx-font-mono);
  font-size: var(--mx-font-caption);
  line-height: 1.6;
  padding: 2px var(--mx-space-2);
  color: var(--mx-text-secondary);
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hit-row.clickable {
  cursor: pointer;
}

.hit-row.clickable:hover {
  color: var(--mx-text);
}

.hits-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}
</style>
