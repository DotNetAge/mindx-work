<script setup lang="ts">
/**
 * AppFrame：整体布局装配（契约第 2 节解剖图，豆包式三列定稿）。
 * 单行三列：Sidebar 全高在左（darwin 交通灯悬浮其顶部拖动带），
 * 中列 = Toolbar（仅 Content 顶部，不横跨全窗）+ Content，
 * Detail 轨道全高独立成列——其头部行与 Toolbar 同一水平线对齐。
 * Overlay 浮层 / Settings 独立面板悬浮其上。
 * 侧栏宽度经 SidebarPane resize 上抛在此持有（几何归壳）：折叠态取 rail 80
 * （对齐 SidebarPane rail 几何），经 --mx-frame-sidebar 变量供 Detail 平分约束取用。
 */
import { computed, ref } from 'vue'
import { useShell, useShellData } from '../reactivity'
import ToolbarPane from './ToolbarPane.vue'
import SidebarPane from './SidebarPane.vue'
import ContentPane from './ContentPane.vue'
import DetailPane from './DetailPane.vue'
import OverlayPane from './OverlayPane.vue'
import SettingsPane from './SettingsPane.vue'

/** 与 SidebarPane WIDTH_DEFAULT 对齐（适配器本地常量不上抛初始值） */
const SIDEBAR_DEFAULT = 248
/** 与 SidebarPane 折叠 rail 几何对齐 */
const SIDEBAR_RAIL = 80

const shell = useShell()
const settingsOpen = useShellData(() => shell.Settings.isOpen)
const collapsed = useShellData(() => shell.sidebarCollapsed)
// Content 中列收起（壳全屏让位 Detail）
const contentCollapsed = useShellData(() => shell.contentCollapsed)
const sidebarWidth = ref(SIDEBAR_DEFAULT)
// 生效侧栏宽：折叠取 rail，展开取拖拽宽——Detail 平分约束的减数
const effSidebar = computed(() => (collapsed.value ? SIDEBAR_RAIL : sidebarWidth.value))
</script>

<template>
  <div :class="$style.frame" :style="{ '--mx-frame-sidebar': `${effSidebar}px` }">
    <SidebarPane @resize="sidebarWidth = $event" />
    <div :class="[$style.main, { [$style.collapsed]: contentCollapsed }]">
      <ToolbarPane />
      <ContentPane />
    </div>
    <DetailPane />
    <OverlayPane />
    <SettingsPane v-if="settingsOpen" />
  </div>
</template>

<style module>
.frame {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--mx-bg-window);
  color: var(--mx-text);
}

/* 中列：Toolbar 位于 Content 顶部（宽度只到 Detail 左缘），不覆盖 Sidebar 与 Detail */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* Content 收起/恢复经 max-width 过渡收放（flex-grow 无法插值，百分比可） */
  max-width: 100%;
  transition: max-width var(--mx-duration-motion) var(--mx-ease-standard);
}

/* Content 收起（Detail 全屏让位）：中列宽度收 0，溢出隐藏防内容撑开 */
.collapsed {
  max-width: 0;
  overflow: hidden;
}

/* macOS 壳：frame 整体透明，窗口 vibrancy 直达侧栏列
 * （主区由 ContentPane 自铺不透明底，对齐 DSH AppFrame.module.css 的 frame 处理） */
:global(html[data-platform='darwin']) .frame {
  background: transparent;
}
</style>
