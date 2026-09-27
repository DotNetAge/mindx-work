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
    <!-- macOS 壳：主区顶部拖动留白条（frame-top-clearance 48px），sticky 常驻 -->
    <div :class="$style.dragBand" data-mx-drag-band aria-hidden="true" />
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

/* macOS 壳：主区顶部 48px 拖动留白（--dsh-frame-top-clearance 同值，
 * DSH AppFrame.module.css L93-95）；sticky 常驻顶部不随内容滚走，
 * 占位即留白（入口内容自然从其下开始）；非 darwin 不渲染 */
.dragBand {
  display: none;
}

:global(html[data-platform='darwin']) .dragBand {
  display: block;
  position: sticky;
  top: 0;
  z-index: 5;
  height: 48px;
  /* flex 纵向容器内不被压缩，满高页面的 flex:1 计算才准确让位 48px */
  flex-shrink: 0;
  -webkit-app-region: drag;
}
</style>
