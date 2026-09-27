<script setup lang="ts">
// collect 节点展开态：各子会话结果摘要列表（PR §2.2 族 2，一阶段简化形态）。
// 结果摘要 = 节点 resultDigests（builder 截取），按 sessionId 顺序与 subagent 卡对应；
// 二阶段此处升级为打开子会话懒加载子树。answer 渲染复用 markdown（摘要多为自然语言）。
// 源：mindx-desktop tree/nodes/collect/CollectNodeView.vue（二期 B 平移）。
import { useMarkdown } from '../../../markdown'
import type { CollectNode } from '../../types/entity'

const props = defineProps<{ node: CollectNode }>()

const { md } = useMarkdown()

function renderDigest(digest: string): string {
  return digest ? md.render(digest) : ''
}
</script>

<template>
  <div class="collect-detail">
    <div
      v-for="(digest, i) in node.resultDigests"
      :key="i"
      class="result-item"
    >
      <div class="result-index">{{ i + 1 }}</div>
      <!-- eslint-disable-next-line vue/no-v-html —— 摘要经 useMarkdown 渲染（内部含 DOMPurify 消毒） -->
      <div class="result-body markdown-body" v-html="renderDigest(digest)"></div>
    </div>
    <div v-if="!node.resultDigests.length" class="result-empty">无结果数据</div>
  </div>
</template>

<style scoped>
.collect-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) 0;
}

.result-item {
  display: flex;
  gap: var(--mx-space-2);
  align-items: flex-start;
}

.result-index {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.result-body {
  flex: 1;
  min-width: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.result-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
