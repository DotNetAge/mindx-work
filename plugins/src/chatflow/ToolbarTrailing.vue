<script setup lang="ts">
/**
 * Toolbar trailing 图标钮：打开会话产物 tab（Detail，概念框架 §6.1）。
 */
import { useShell, ToolbarIconButton } from '@mindx-work/ui-shell-vue'
import { PRODUCT_DETAIL_ID } from './ids'

const shell = useShell()

function activate(): void {
  shell.Detail.show(PRODUCT_DETAIL_ID)
}
</script>

<template>
  <ToolbarIconButton
    icon="lucide:list-todo"
    label="打开会话产物"
    @activate="activate"
  />
</template>
