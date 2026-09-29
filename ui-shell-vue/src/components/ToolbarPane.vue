<script setup lang="ts">
/** ToolbarPane：窗口工具栏 leading / trailing 两席位 + Content 活动条目标题。
 * 席位按层呈现：owner 省略 = 全局层恒显；owner = Content 条目 id 的仅该条目激活时呈现 */
import { useShell, useShellData } from '../reactivity'

const shell = useShell()
// 平台判定：darwin 下工具栏常驻，承担主区顶部 48px 拖动带职责（原 ContentPane dragBand 并入）
const isDarwin = document.documentElement.dataset.platform === 'darwin'
const data = useShellData(() => {
  const activeId = shell.Content.activeId
  const byLayer = (owner?: string): boolean => !owner || owner === activeId
  return {
    leading: shell.Toolbar.entries.filter((entry) => entry.slot === 'leading' && byLayer(entry.owner)),
    trailing: shell.Toolbar.entries.filter((entry) => entry.slot === 'trailing' && byLayer(entry.owner)),
    title: shell.Content.entries.find((entry) => entry.id === activeId)?.title ?? '',
  }
})
</script>

<template>
  <!-- darwin 常驻（拖动带 + title 呈现）；其余平台沿用无席位不渲染（无通栏观感） -->
  <header
    v-if="isDarwin || data.leading.length || data.trailing.length"
    :class="$style.toolbar"
    data-mx-drag-band
  >
    <div :class="$style.group">
      <component :is="entry.component" v-for="entry in data.leading" :key="entry.id" />
    </div>
    <!-- 零文案壳：标题全部来自 Content 条目的 title，无标题则留白 -->
    <div :class="$style.title">{{ data.title }}</div>
    <div :class="$style.group">
      <component :is="entry.component" v-for="entry in data.trailing" :key="entry.id" />
    </div>
  </header>
</template>

<style module>
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  height: 48px;
  padding: 0 var(--mx-space-3);
  background: var(--mx-bg-surface);
  border-bottom: 1px solid var(--mx-separator);
  flex-shrink: 0;
  /* macOS 壳：整条为窗口拖动带（并入原 ContentPane dragBand 职责），
   * 双击最大化等系统行为随之保留；席位内按钮组显式 no-drag */
  -webkit-app-region: drag;
}

.group {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  min-width: 0;
  -webkit-app-region: no-drag;
}

.title {
  flex: 1;
  font: var(--mx-font-heading);
  color: var(--mx-text);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
