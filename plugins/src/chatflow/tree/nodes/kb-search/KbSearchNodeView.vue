<script setup lang="ts">
// tool.kb_search 节点展开态：知识库命中块列表（PR 对照表「命中块列表」）。
// 命中块 = outputTail（QuickSearch 结果 JSON 或文本块），结构化命中优先、文本行兜底。
import { computed } from 'vue'
import { useMarkdown } from '../../../markdown'
import { parseToolResult } from '../../../toolViewUtils'
import { rowsFromTail } from '../shared/rows'
import LangBadge from '../shared/LangBadge.vue'
import type { KbSearchToolNode } from '../../types/tool'

const props = defineProps<{ node: KbSearchToolNode }>()

const { md } = useMarkdown()

/** 结构化命中块（content/text 字段优先，chunk/path 辅助标注） */
const chunks = computed<Array<{ source: string; content: string }>>(() => {
  const parsed = parseToolResult(props.node.outputTail || '')
  if (!parsed) return []
  const list = Array.isArray(parsed.hits)
    ? parsed.hits
    : Array.isArray(parsed.results)
      ? parsed.results
      : Array.isArray(parsed.chunks)
        ? parsed.chunks
        : []
  return list
    .map((h: unknown) => {
      const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>
      return {
        source: typeof o.source === 'string' ? o.source : typeof o.path === 'string' ? o.path : '',
        content: typeof o.content === 'string' ? o.content : typeof o.text === 'string' ? o.text : '',
      }
    })
    .filter(c => c.content)
    .slice(0, 20)
})

const fallbackRows = computed(() => (chunks.value.length ? [] : rowsFromTail(props.node.outputTail)))

function renderContent(s: string): string {
  return s ? md.render(s) : ''
}
</script>

<template>
  <div class="kbsearch-detail">
    <el-tooltip v-if="node.targetDir" :content="node.targetDir" placement="top" :hide-after="0">
      <div class="detail-dir">范围：{{ node.targetDir }}</div>
    </el-tooltip>

    <div v-if="chunks.length" class="chunk-list">
      <div v-for="(c, i) in chunks" :key="i" class="chunk-item">
        <el-tooltip v-if="c.source" :content="c.source" placement="top" :hide-after="0">
          <div class="chunk-source"><LangBadge :path="c.source" size="sm" />{{ c.source }}</div>
        </el-tooltip>
        <!-- eslint-disable-next-line vue/no-v-html —— 命中块经 useMarkdown 渲染（内部含 DOMPurify 消毒） -->
        <div class="chunk-body markdown-body" v-html="renderContent(c.content)"></div>
      </div>
    </div>
    <div v-else-if="fallbackRows.length" class="fallback-rows">
      <div v-for="(row, i) in fallbackRows" :key="i" class="fallback-row">{{ row }}</div>
    </div>
    <div v-else class="detail-empty">知识库中未检索到相关内容</div>
  </div>
</template>

<style scoped>
.kbsearch-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) 0;
}

.detail-dir {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chunk-list {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  max-height: 400px;
  overflow-y: auto;
}

/* 平铺样式：去边框，仅保留缩进留白 */
.chunk-item {
  padding: var(--mx-space-2) 0 0;
}

.chunk-source {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-accent);
  margin-bottom: var(--mx-space-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chunk-body {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fallback-rows {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-secondary);
}

.fallback-row {
  padding: 1px 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.detail-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
