<script setup lang="ts">
/**
 * AppFrame：整体布局装配（契约第 2 节解剖图）。
 * Toolbar 顶部 / Sidebar + Content + Detail 三栏 / Overlay 浮层 / Settings 独立面板。
 */
import { useShell, useShellData } from '../reactivity'
import ToolbarPane from './ToolbarPane.vue'
import SidebarPane from './SidebarPane.vue'
import ContentPane from './ContentPane.vue'
import DetailPane from './DetailPane.vue'
import OverlayPane from './OverlayPane.vue'
import SettingsPane from './SettingsPane.vue'

const shell = useShell()
const settingsOpen = useShellData(() => shell.Settings.isOpen)
</script>

<template>
  <div :class="$style.frame">
    <ToolbarPane />
    <div :class="$style.body">
      <SidebarPane />
      <ContentPane />
      <DetailPane />
    </div>
    <OverlayPane />
    <SettingsPane v-if="settingsOpen" />
  </div>
</template>

<style module>
.frame {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--mx-bg-window);
  color: var(--mx-text);
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* macOS 壳：frame 整体透明，窗口 vibrancy 直达侧栏列
 * （主区由 ContentPane 自铺不透明底，对齐 DSH AppFrame.module.css 的 frame 处理） */
:global(html[data-platform='darwin']) .frame {
  background: transparent;
}
</style>
