<script setup lang="ts">
// RoundHeader —— 轮根渲染层之轮头（PR §7.1 round/：user + 复制）。
// 现役 UserMessageRow 已承载轮头全部职责（参考文件 chip / 图片 / 复制 / 回退 / 删除），
// 此处薄包装对齐 round/ 目录规划，不复制实现。
import UserMessageRow from '../../chatround/UserMessageRow.vue'
import type { ChatMessage } from '../../model/message'

defineProps<{ message: ChatMessage }>()

const emit = defineEmits<{
  (e: 'undo-round', messageId: number, restoreContent?: string): void
}>()

function onUndo(messageId: number, restoreContent?: string): void {
  emit('undo-round', messageId, restoreContent)
}
</script>

<template>
  <UserMessageRow :message="message" @undo-round="onUndo" />
</template>
