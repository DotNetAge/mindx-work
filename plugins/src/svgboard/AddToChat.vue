<script setup lang="ts">
/**
 * DetailToolbar 尾段按钮：画板「添加到对话」。
 * 未落盘或存在未保存改动时先保存（引用的是磁盘文件，Agent 只能读已落盘内容；
 * 新画板保存走系统对话框，取消即中止不添加），再经 chatflow.store 服务把
 * 当前文件追加为对话输入框的引用 chip（explorer「添加到对话」同通道）。
 */
import { ElMessage } from 'element-plus'
import { ToolbarIconButton, useService } from '@mindx-work/ui-shell-vue'
import { useSvgboardStore } from './store'

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

async function addToChat(): Promise<void> {
  const store = useSvgboardStore()
  if (store.dirty || !store.currentFile) {
    // 面板未挂载时按钮不可见（owner 归属），serializer 必已登记；兜底提示防呆
    const svg = store.serializer?.()
    if (svg === undefined) {
      ElMessage.warning('画板尚未就绪，无法添加到对话')
      return
    }
    const ok = await store.save(svg)
    if (!ok) {
      if (store.error) ElMessage.error('保存失败，无法添加到对话')
      return
    }
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
