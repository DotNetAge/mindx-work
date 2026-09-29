<script setup lang="ts">
/**
 * CalendarFooterRow —— Sidebar Footer 固定区「日历」入口行（与设置行同区，
 * 不随内容滚动，几何对齐 ChromeFooter：42 高 / radius 12 / margin 4 -2）。
 * 点击激活 Content 日历视图；选中态跟随壳 Content.activeId。
 * 视图 id 与 index.ts 的 CALENDAR_VIEW_ID 同值（本地字面量，避免循环 import）。
 */
import { MxIcon, useShell, useShellData } from '@mindx-work/ui-shell-vue'

const props = defineProps<{ compact?: boolean }>()
const shell = useShell()
const activeId = useShellData(() => shell.Content.activeId)

function openCalendar(): void {
  shell.Content.activate('calendar-view')
}
</script>

<template>
  <div :class="$style.footer">
    <button
      type="button"
      :class="[$style.action, { [$style.compactAction]: props.compact }]"
      :data-active="activeId === 'calendar-view' ? 'true' : 'false'"
      :title="props.compact ? '日历' : undefined"
      aria-label="打开日历"
      @click="openCalendar"
    >
      <MxIcon name="lucide:calendar" :size="props.compact ? 20 : 16" />
      <span v-if="!props.compact">日历</span>
    </button>
  </div>
</template>

<style module>
/* 容器：无间距（行自身承载），对齐 ChromeFooter */
.footer {
  display: flex;
  flex-direction: column;
}

/* 入口行：42 高 / radius 12 / margin 4 -2（ChromeFooter.action 同值）；
   选中态复用壳 row data-active 观感（hover 底色） */
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

.action:hover:not([data-active='true']) {
  background: var(--mx-hover);
}

.action:active:not([data-active='true']) {
  background: var(--mx-active);
}

.action:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.action[data-active='true'] {
  background: var(--mx-hover);
}

/* 折叠 rail：36x36 居中、radius 12、margin 0（ChromeFooter.compact 同值） */
.compactAction {
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border-radius: var(--mx-radius-card);
}
</style>
