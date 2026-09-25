<script setup lang="ts">
/** ToolbarPane：窗口工具栏 leading / trailing 两席位 + Content 活动条目标题 */
import { useShell, useShellData } from '../reactivity'

const shell = useShell()
const data = useShellData(() => ({
  leading: shell.Toolbar.entries.filter((entry) => entry.slot === 'leading'),
  trailing: shell.Toolbar.entries.filter((entry) => entry.slot === 'trailing'),
  title:
    shell.Content.entries.find((entry) => entry.id === shell.Content.activeId)?.title ?? '',
}))
</script>

<template>
  <!-- 对齐 DSH：无席位时整个不渲染（无通栏观感；title 呈现随 Toolbar 存在而存在） -->
  <header v-if="data.leading.length || data.trailing.length" :class="$style.toolbar">
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
}

.group {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  min-width: 0;
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
