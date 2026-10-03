<script setup lang="ts">
/**
 * Toolbar trailing 图标钮：新建空白画板（svgboard Detail tab，未落盘态，
 * 保存时走系统对话框选路径）。
 */
import { ToolbarIconButton } from '@mindx-work/ui-shell-vue'
import { useSvgboardStore } from './store'

function activate(): void {
  useSvgboardStore().create()
}
</script>

<template>
  <ToolbarIconButton
    icon="lucide:frame"
    label="新建画板"
    @activate="activate"
  />
</template>
