<script setup lang="ts">
/** ContentPane：单活动视图。activeId 壳唯一写，活动条目随 Sidebar 行切换。 */
import { useShell, useShellData } from '../reactivity'

const shell = useShell()
const active = useShellData(
  () => shell.Content.entries.find((entry) => entry.id === shell.Content.activeId) ?? null,
)
</script>

<template>
  <main :class="$style.content">
    <component :is="active.component" v-if="active" :active="true" />
  </main>
</template>

<style module>
.content {
  flex: 1;
  min-width: 0;
  /* 纵向 flex + overflow 兜底：满高型页面（对话流等）以 flex:1 + min-height:0
     撑满视口并自滚动，输入区钉底不被内容挤出；普通文档型页面高度自然，
     超高时仍由本容器整体滚动（滚动语义向后兼容） */
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--mx-bg-window);
}

/* macOS 壳：主区自铺不透明底（保住内容区不透 vibrancy），
 * 并把侧栏分隔线移到主区左缘——半透明侧栏上的 alpha 边框会与壁纸混成暗缝
 * （对齐 DSH AppFrame.module.css 的 centerCol 处理） */
:global(html[data-platform='darwin']) .content {
  border-left: 0.5px solid var(--mx-border-strong);
}
</style>
