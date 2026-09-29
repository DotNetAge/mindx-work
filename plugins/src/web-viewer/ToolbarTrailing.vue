<script setup lang="ts">
/**
 * Toolbar trailing 图标钮：打开网页浏览（web-viewer Detail tab）。
 * 已有页签时聚焦轨道，无页签时新开空白页签（地址栏引导输入）。
 */
import { useShell, ToolbarIconButton } from '@mindx-work/ui-shell-vue'
import { useWebViewerStore, WEB_VIEWER_DETAIL_ID } from './store'

const shell = useShell()

function activate(): void {
  const store = useWebViewerStore()
  if (store.tabs.length) {
    shell.Detail.show(WEB_VIEWER_DETAIL_ID)
  } else {
    store.newTab()
  }
}
</script>

<template>
  <ToolbarIconButton
    icon="lucide:globe"
    label="打开网页浏览"
    @activate="activate"
  />
</template>
