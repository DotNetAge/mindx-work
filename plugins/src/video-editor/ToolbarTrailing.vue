<script setup lang="ts">
/**
 * Toolbar trailing 图标钮：新建剪辑项目（未落盘态，保存时走系统对话框）。
 * 打开既有项目走 explorer 双击 .vedit 文件（fileTypes 接管）。
 */
import { ToolbarIconButton } from '@mindx-work/ui-shell-vue'
import { useVideoEditorStore } from './store'

function activate(): void {
  useVideoEditorStore().create()
}
</script>

<template>
  <ToolbarIconButton
    icon="lucide:clapperboard"
    label="新建剪辑项目"
    @activate="activate"
  />
</template>
