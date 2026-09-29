<script setup lang="ts">
// Sidebar Footer 固定区入口行：对齐 ChromeFooter 几何（42 高/radius 12/margin 4 -2），
// 折叠 rail 时退化为 36px 图标钮（壳渲染 footer 时已传 compact）。
// 选中态经 useShellData 读 Content.activeId 自绘（footer 行无壳默认选中态）。
import { MxIcon, useShell, useShellData } from '@mindx-work/ui-shell-vue'
import { USAGE_VIEW_ID } from './ids'

defineProps<{ compact?: boolean }>()

const shell = useShell()
const isActive = useShellData(() => shell.Content.activeId === USAGE_VIEW_ID)

function open(): void {
  shell.Content.activate(USAGE_VIEW_ID)
}
</script>

<template>
  <button
    type="button"
    class="usage-footer-row"
    :class="{ compact, active: isActive }"
    :title="compact ? '用量' : undefined"
    @click="open"
  >
    <MxIcon name="lucide:coins" :size="16" />
    <span v-if="!compact" class="label">用量</span>
  </button>
</template>

<style scoped>
.usage-footer-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  height: 42px;
  margin: 4px -2px;
  padding: 0 var(--mx-space-3);
  width: calc(100% + 4px);
  box-sizing: border-box;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-secondary);
  font: var(--mx-font-body);
  cursor: pointer;
  transition: background var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.usage-footer-row:hover {
  background: var(--mx-bg-surface);
  color: var(--mx-text);
}

.usage-footer-row:focus-visible {
  outline: 1px solid var(--mx-accent);
  outline-offset: -1px;
}

.usage-footer-row.active {
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
  color: var(--mx-text);
}

/* 折叠 rail：36px 方形图标钮 */
.usage-footer-row.compact {
  width: 36px;
  height: 36px;
  margin: 4px auto;
  padding: 0;
  justify-content: center;
}

.label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
  .usage-footer-row {
    transition: none;
  }
}
</style>
