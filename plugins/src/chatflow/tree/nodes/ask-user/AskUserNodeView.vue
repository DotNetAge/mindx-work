<script setup lang="ts">
// ask_user 节点展开态：问答详情（问题 + 选项 + 回答，PR §2.2 族 3）。
// 实时阻塞交互在吸底 Drawer（取舍 7），此处是事后留痕的回看视图。
// 源：mindx-desktop tree/nodes/ask-user/AskUserNodeView.vue（二期 B 平移）。
import type { AskUserNode } from '../../types/system'

defineProps<{ node: AskUserNode }>()
</script>

<template>
  <div class="qa-detail">
    <div
      v-for="(q, i) in node.questions"
      :key="i"
      class="qa-item"
    >
      <div class="qa-question">{{ q.question }}</div>
      <div v-if="q.options?.length" class="qa-options">
        <span
          v-for="(opt, j) in q.options"
          :key="j"
          class="qa-option"
        >{{ opt }}</span>
      </div>
      <!-- 回答与问题按序对应：v-if 判空后取值（noUncheckedIndexedAccess 需非空断言） -->
      <div v-if="node.answers[i]?.answer" class="qa-answer">
        <span class="answer-label">回答</span>
        <span class="answer-text">{{ node.answers[i]!.answer }}</span>
      </div>
    </div>
    <div v-if="!node.questions.length && node.answers.length" class="qa-item">
      <div v-for="(a, i) in node.answers" :key="i" class="qa-answer">
        <span class="answer-label">回答</span>
        <span class="answer-text">{{ a.answer }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qa-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-1) 0;
}

.qa-item {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.qa-question {
  font: var(--mx-font-caption);
  color: var(--mx-text);
  font-weight: 600;
}

.qa-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mx-space-1);
}

/* 平铺样式：选项去边框改纯文本 */
.qa-option {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  padding: 1px 0;
}

.qa-answer {
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-2);
}

.answer-label {
  flex-shrink: 0;
  font: var(--mx-font-caption);
  color: var(--mx-accent);
}

.answer-text {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  word-break: break-word;
}
</style>
