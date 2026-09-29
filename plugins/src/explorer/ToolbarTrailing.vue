<script setup lang="ts">
/**
 * Toolbar trailing 图标钮：打开当前工作目录（explorer Detail tab）。
 * 工作目录取 chatflow.store 的 currentProjectDir（跨插件以字符串服务名消费，
 * 契约 §10.2 禁止跨插件 import）；无会话时回退用户主目录。
 */
import { useService, ToolbarIconButton } from '@mindx-work/ui-shell-vue'
import { useExplorerStore } from './store'

// 跨插件服务形状契约（消费侧仅声明所需形状）
interface ChatflowServiceShape {
  readonly store: { currentProjectDir: string }
}
interface DaemonConnectionShape {
  call<T>(method: string, params?: unknown): Promise<T>
}

const explorer = useExplorerStore()
const chatflow = useService<ChatflowServiceShape>('chatflow.store')
const daemon = useService<DaemonConnectionShape>('daemon.connection')

async function activate(): Promise<void> {
  const dir = chatflow.store.currentProjectDir
  if (dir) {
    await explorer.open(dir)
    return
  }
  // 无会话：回退主目录（open 内部自行拉出 Detail）
  try {
    const home = await daemon.call<{ path: string }>('fs.home', {})
    await explorer.open(home.path)
  } catch {
    // 主目录也失败（daemon 未连）：静默，不打扰
  }
}
</script>

<template>
  <ToolbarIconButton
    icon="lucide:folder"
    label="打开当前工作目录"
    @activate="activate"
  />
</template>
