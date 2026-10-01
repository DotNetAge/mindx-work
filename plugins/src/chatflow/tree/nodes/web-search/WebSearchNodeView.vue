<script setup lang="ts">
// tool.web_search 节点展开态：结果列表（PR §3.2 新增最小集合）。
// 结果源 = outputTail：结构化 SearchResult JSON 走 hits 列表；
// Markdown 文本形态（搜索工具的文本输出）解析失败时降级为 Markdown 渲染；
// 两者皆空才显示"无搜索结果"。行/链接点击经名片操作统一处理。
import { computed } from 'vue'
import { parseToolResult } from '../../../toolViewUtils'
import { useChatflowStore } from '../../../store'
import FormattedContent from '../../../chatround/FormattedContent.vue'
import type { WebSearchToolNode } from '../../types/tool'

const props = defineProps<{ node: WebSearchToolNode }>()

// 链接点击统一路由 web-viewer（详情轨道），拦截默认新窗口行为
function openInViewer(event: MouseEvent, url: string): void {
  event.preventDefault()
  useChatflowStore().openUrl(url)
}

interface SearchHit {
  title: string
  url: string
  snippet: string
}

/** 从结果 JSON 提取结构化命中（title/url/snippet 字段已核对 SearchResult.Source） */
const hits = computed<SearchHit[]>(() => {
  const parsed = parseToolResult(props.node.outputTail || '')
  if (!parsed) return []
  const list = Array.isArray(parsed.results)
    ? parsed.results
    : Array.isArray(parsed.sources)
      ? parsed.sources
      : []
  return list
    .map((r: unknown) => {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      return {
        title: typeof o.title === 'string' ? o.title : '',
        url: typeof o.url === 'string' ? o.url : '',
        snippet: typeof o.snippet === 'string' ? o.snippet : '',
      }
    })
    .filter(h => h.title || h.url)
    .slice(0, 50)
})

/** 降级 Markdown 文本（非 JSON 形态的原始输出，如 "## 搜索结果 ..."） */
const fallbackText = computed(() =>
  hits.value.length ? '' : (props.node.outputTail || '').trim(),
)
</script>

<template>
  <div class="websearch-detail">
    <div class="detail-meta">
      <span v-if="node.engines?.length" class="meta-engines">引擎：{{ node.engines.join(' → ') }}</span>
      <span v-if="node.failedEngines?.length" class="meta-failed">回退：{{ node.failedEngines.join('、') }}</span>
    </div>

    <div v-if="hits.length" class="hit-list">
      <a
        v-for="(h, i) in hits"
        :key="i"
        class="hit-item"
        :href="h.url"
        @click="openInViewer($event, h.url)"
      >
        <div class="hit-title">{{ h.title || h.url }}</div>
        <div v-if="h.snippet" class="hit-snippet">{{ h.snippet }}</div>
      </a>
    </div>
    <div v-else-if="fallbackText" class="fallback-md">
      <FormattedContent :content="fallbackText" />
    </div>
    <div v-else class="detail-empty">无搜索结果</div>
  </div>
</template>

<style scoped>
.websearch-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) 0;
}

.detail-meta {
  display: flex;
  gap: var(--mx-space-3);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.meta-failed {
  color: var(--mx-warning);
}

.hit-list {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  max-height: 400px;
  overflow-y: auto;
}

/* 平铺样式：去边框与 hover 底色块，链接条目平铺 */
.hit-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--mx-space-2) 0 0;
  text-decoration: none;
}

.hit-title {
  font: var(--mx-font-caption);
  color: var(--mx-accent);
  font-weight: 600;
}

.hit-snippet {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Markdown 降级形态：与 hit-list 同样的滚动约束，正文字号适配工具详情区 */
.fallback-md {
  max-height: 400px;
  overflow-y: auto;
  font: var(--mx-font-caption);
}

.fallback-md :deep(.formatted-content) {
  font: var(--mx-font-caption);
  line-height: 1.6;
}

.detail-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
