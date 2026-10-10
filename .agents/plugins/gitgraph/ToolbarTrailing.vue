<script setup lang="ts">
/**
 * Toolbar trailing 图标钮：打开 Git 图（Detail 轨道 Git 图 tab）。
 * 数据加载归 GitGraphPanel 挂载期（tab 打开才拉取，避免后台空跑）。
 */
import { useShell, ToolbarIconButton } from '@mindx-work/ui-shell-vue'
import { GITGRAPH_DETAIL_ID } from './store'

const shell = useShell()

function activate(): void {
  shell.Detail.show(GITGRAPH_DETAIL_ID)
}
</script>

<template>
  <ToolbarIconButton icon="lucide:git-graph" label="打开 Git 图" @activate="activate" />
</template>
