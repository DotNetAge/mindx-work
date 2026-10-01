<script setup lang="ts">
/**
 * DetailToolbar 尾段按钮：把当前预览的文档追加为对话输入框的引用 chip
 * （经 chatflow.store 服务 appendFileRef，explorer「添加到对话」同通道）。
 */
import { ElMessage } from 'element-plus'
import { ToolbarIconButton, useService } from '@mindx-work/ui-shell-vue'
import { useDocPreviewStore } from './store'

/** chatflow 服务最小形状（消费侧本地声明，禁止跨插件 import） */
interface ChatflowServiceLike {
  appendFileRef(ref: { path: string; isDir?: boolean }): boolean
}
/** chatflow 服务引用（插件可停用，null = 不可用，点击时降级提示） */
let chatflow: ChatflowServiceLike | null = null
try {
  chatflow = useService<ChatflowServiceLike>('chatflow.store')
} catch {
  chatflow = null
}

function addToChat(): void {
  const store = useDocPreviewStore()
  if (!store.currentFile) {
    ElMessage.warning('尚未打开任何文档')
    return
  }
  if (!chatflow) {
    ElMessage.warning('对话插件未启用，无法添加到对话')
    return
  }
  if (!chatflow.appendFileRef({ path: store.currentFile })) {
    ElMessage.warning('对话页未打开，无法添加到对话')
  }
}
</script>

<template>
  <ToolbarIconButton icon="lucide:message-circle-plus" label="添加到对话" @activate="addToChat" />
</template>
