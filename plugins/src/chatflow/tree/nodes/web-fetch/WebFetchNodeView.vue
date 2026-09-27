<script setup lang="ts">
// tool.web_fetch 节点展开态（轻量化）：只显示 URL 行。
// 抓取正文不落地不渲染（大段页面正文太耗 DOM，内容无回看价值），大小信息在名片悬浮。
import type { WebFetchToolNode } from '../../types/tool'

defineProps<{ node: WebFetchToolNode }>()
</script>

<template>
  <div class="webfetch-detail">
    <a class="detail-url" :href="node.url" target="_blank" rel="noopener">{{ node.url }}</a>
  </div>
</template>

<style scoped>
.webfetch-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.detail-url {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-accent);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-url:hover {
  text-decoration: underline;
}
</style>
