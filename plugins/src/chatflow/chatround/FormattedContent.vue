<script setup lang="ts">
import { computed, useTemplateRef, nextTick, onMounted, watch } from 'vue'
import { useMarkdown } from '../markdown'
import { handleContentClick, injectFileLinks } from '../toolViewUtils'

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
})

// 与对话流共用同一套 markdown-it 实例：marked 解析 + hljs 高亮 + DOMPurify 消毒
const { md } = useMarkdown()

const formattedContent = computed(() => {
  if (!props.content) return ''
  return md.render(props.content)
})

// markdown 渲染完成后注入可点击的文件路径链接
const rootRef = useTemplateRef<HTMLElement>('root')

async function afterRender() {
  await nextTick()
  if (rootRef.value) injectFileLinks(rootRef.value)
}

onMounted(afterRender)
watch(() => props.content, afterRender, { flush: 'post' })
</script>

<template>
  <div ref="root" class="formatted-content markdown-body" v-html="formattedContent" @click="handleContentClick"></div>
</template>

<style scoped>
.formatted-content {
  font: var(--mx-font-body);
  line-height: 1.75;
  color: var(--mx-text);
  word-wrap: break-word;
}

.formatted-content :deep(h1),
.formatted-content :deep(h2),
.formatted-content :deep(h3) {
  color: var(--mx-text);
  font-weight: 700;
  margin: var(--mx-space-3) 0 var(--mx-space-2);
}

.formatted-content :deep(h1) { font: var(--mx-font-heading); }
.formatted-content :deep(h2) { font: var(--mx-font-heading); }
.formatted-content :deep(h3) { font: var(--mx-font-heading); font-size: inherit; }

.formatted-content :deep(p) {
  margin: var(--mx-space-2) 0;
}

.formatted-content :deep(strong) {
  color: var(--mx-text);
  font-weight: 600;
}

.formatted-content :deep(em) {
  font-style: italic;
  color: var(--mx-accent);
}

.formatted-content :deep(code) {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  color: var(--mx-accent);
  padding: 2px var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 15%, transparent);
}

.formatted-content :deep(.code-block) {
  background: var(--mx-bg-surface);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 50%, transparent);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-3);
  margin: var(--mx-space-3) 0;
  overflow-x: auto;
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  line-height: 1.6;
  color: var(--mx-text);
}

.formatted-content :deep(.code-block) code {
  background: none;
  padding: 0;
  border: none;
}

.formatted-content :deep(ul),
.formatted-content :deep(ol) {
  padding-left: var(--mx-space-6);
  margin: var(--mx-space-2) 0;
}

.formatted-content :deep(li) {
  margin: var(--mx-space-1) 0;
}

.formatted-content :deep(blockquote) {
  border-left: 3px solid var(--mx-accent);
  padding-left: var(--mx-space-3);
  margin: var(--mx-space-3) 0;
  color: var(--mx-text-tertiary);
  font-style: italic;
}

.formatted-content :deep(a) {
  color: var(--mx-accent);
  text-decoration: none;
}

.formatted-content :deep(a:hover) {
  text-decoration: underline;
}

.formatted-content :deep(.file-path-link) {
  display: inline;
  color: color-mix(in srgb, var(--mx-accent) 70%, white);
  font-weight: 600;
  padding: 0 var(--mx-space-1);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--mx-accent) 30%, transparent);
  cursor: pointer;
  transition: all 0.15s ease;
}

.formatted-content :deep(.file-path-link:hover) {
  background: color-mix(in srgb, var(--mx-accent) 18%, transparent);
  border-bottom-color: color-mix(in srgb, var(--mx-accent) 70%, white);
}

.formatted-content :deep(hr) {
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--mx-separator) 50%, transparent);
  margin: var(--mx-space-3) 0;
}

.formatted-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: var(--mx-space-3) 0;
}

.formatted-content :deep(th),
.formatted-content :deep(td) {
  border: 1px solid color-mix(in srgb, var(--mx-separator) 50%, transparent);
  padding: var(--mx-space-2) var(--mx-space-3);
  text-align: left;
}

.formatted-content :deep(th) {
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
  font-weight: 600;
}
</style>
