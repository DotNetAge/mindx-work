<script setup lang="ts">
/** Sidebar Footer 固定区：设置入口（demo SidebarFooter 范式，仅保留有真实消费者的动作）。 */
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'

const props = defineProps<{ compact?: boolean }>()
const shell = useShell()
</script>

<template>
  <div :class="[$style.footer, { [$style.footerCompact]: props.compact }]">
    <button
      type="button"
      :class="[$style.action, { [$style.compact]: props.compact }]"
      :title="props.compact ? '设置' : undefined"
      @click="shell.Settings.open()"
    >
      <MxIcon name="lucide:settings" :size="props.compact ? 20 : 16" />
      <span v-if="!props.compact">设置</span>
    </button>
  </div>
</template>

<style module>
/* footArea 无容器间距：行距由行自身 margin 承载 */
.footer {
  display: flex;
  flex-direction: column;
}

/* 设置触发行：height 42 / padding 0 10 0 8 / radius 12 / margin 4px -2px */
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

/* 折叠 rail：36x36、radius 12、margin 0；盒间 gap 12 */
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
