<script setup lang="ts">
// content 节点视图（树壳直渲形态，源：mindx-desktop tree/nodes/content）：
// 叙述/答案是同一类型的状态分支（取舍 5）。
// - 正文渲染复用 FormattedContent（markdown + mermaid + 文件链接注入）；
// - 答案形态（finishReason=stop）提供朗读（speak），expose 供 shell 操作分派器调用
//   （registry/actions.ts 声明的 id → 视图方法）；「原文/渲染」切换冗余已删（答案即渲染态）；
// - 用量统计 / Context ring 是轮级功能，归 round/，本组件不承载（PR §4.3）。
import { computed, ref } from 'vue'
import FormattedContent from '../../../chatround/FormattedContent.vue'
import type { ContentNode } from '../../types/content'

const props = defineProps<{ node: ContentNode }>()

const isSpeaking = ref(false)
const isPaused = ref(false)

const isAnswer = computed(() => props.node.finishReason === 'stop')
const rawText = computed(() => props.node.content || '')

// ── 朗读（平移自 ResultView：stripMarkdown + speechSynthesis 暂停/恢复） ──
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/>\s+/g, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function speak(): void {
  if (!rawText.value) return
  const synth = window.speechSynthesis
  if (isSpeaking.value) {
    if (isPaused.value) {
      synth.resume()
      isPaused.value = false
    } else {
      synth.pause()
      isPaused.value = true
    }
    return
  }
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(stripMarkdown(rawText.value))
  utterance.onend = () => {
    isSpeaking.value = false
    isPaused.value = false
  }
  utterance.onerror = () => {
    isSpeaking.value = false
    isPaused.value = false
  }
  isSpeaking.value = true
  synth.speak(utterance)
}

/** shell 操作分派入口：speak（registry actions 声明 → 视图方法） */
defineExpose({ speak })
</script>

<template>
  <div class="content-view" :class="{ answer: isAnswer }">
    <!-- 渲染形态：复用 FormattedContent（markdown/mermaid/文件链接） -->
    <FormattedContent :content="rawText" />
  </div>
</template>

<style scoped>
.content-view {
  position: relative;
  padding: var(--mx-space-1) 0;
}

.content-view.answer {
  padding: var(--mx-space-2) 0;
}
</style>
