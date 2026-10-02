<script setup lang="ts">
/**
 * DetailToolbar 尾段按钮：仪表板「添加到对话」。
 * 仪表板文件由 Agent 落盘（本插件只读，无需先保存）；经 chatflow.store 服务把
 * 当前仪表板文件追加为对话输入框的引用 chip（explorer「添加到对话」同通道），
 * 用户借此把整块仪表板指给 Agent 深入分析或改版。
 */
import { ElMessage } from 'element-plus'
import { ToolbarIconButton, useService } from '@mindx-work/ui-shell-vue'
import { useKanbanStore } from './store'

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
  const store = useKanbanStore()
  if (!store.currentFile) {
    ElMessage.warning('没有打开的仪表板，无法添加到对话')
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
