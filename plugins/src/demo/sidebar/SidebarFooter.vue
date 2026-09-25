<script setup lang="ts">
/** Sidebar Footer 固定区：固定操作行（插件市场 / 手机连接 / 设置），对齐 DSH 侧栏底部 */
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'

const props = defineProps<{ compact?: boolean }>()
const shell = useShell()

/** 固定操作行定义；动作可选——demo 中无目标页的行仅作展示占位 */
const actions = [
  { id: 'market', label: '插件市场', icon: 'lucide:store' },
  { id: 'phone', label: '手机连接', icon: 'lucide:smartphone' },
  { id: 'settings', label: '设置', icon: 'lucide:settings' },
]

function onAction(id: string) {
  if (id === 'settings') {
    shell.Settings.open()
  }
}
</script>

<template>
  <div :class="[$style.footer, { [$style.footerCompact]: props.compact }]">
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      :class="[$style.action, { [$style.compact]: props.compact }]"
      :title="props.compact ? action.label : undefined"
      @click="onAction(action.id)"
    >
      <MxIcon :name="action.icon" :size="props.compact ? 20 : 16" />
      <span v-if="!props.compact">{{ action.label }}</span>
    </button>
  </div>
</template>

<style module>
/* footArea 无容器间距（SidebarRoot L550-554）：行距由行自身 margin 承载 */
.footer {
  display: flex;
  flex-direction: column;
}

/* 设置触发行（trigger，SettingsRoot.module.css L16-35）：
   height 42 / padding 0 10 0 8 / radius 12 / margin 4px -2px / 14px */
.action {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  width: calc(100% + 4px);
  height: 42px;
  margin: 4px -2px;
  box-sizing: border-box;
  padding: 0 10px 0 8px;
  flex-shrink: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.action:hover {
  background: var(--mx-hover);
}

.action:active {
  background: var(--mx-active);
}

.action:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.action:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 折叠 rail（trigger.rail L44-52）：36x36、radius 12、margin 0；盒间 gap 12（rail 节奏） */
.footerCompact {
  gap: var(--mx-space-3);
  align-items: center;
}

.compact {
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border-radius: var(--mx-radius-card);
}
</style>
