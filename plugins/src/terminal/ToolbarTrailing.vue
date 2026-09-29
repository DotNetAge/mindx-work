<script setup lang="ts">
/**
 * Toolbar trailing 图标钮：打开终端（Detail 轨道终端 tab）。
 * 终端每次打开都是当前 cwd 的新会话（DetailPane 切 tab 卸载组件），
 * 故此处只负责拉出轨道，会话生命周期归 TerminalPanel。
 */
import { useShell, ToolbarIconButton } from '@mindx-work/ui-shell-vue'
import { TERMINAL_DETAIL_ID } from './ids'

const shell = useShell()

function activate(): void {
  shell.Detail.show(TERMINAL_DETAIL_ID)
}
</script>

<template>
  <ToolbarIconButton
    icon="lucide:terminal"
    label="打开终端"
    @activate="activate"
  />
</template>
