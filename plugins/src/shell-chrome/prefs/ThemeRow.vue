<script setup lang="ts">
/** 外观行：主题三卡选择（承接自 demo，几何对齐 DSH AppearanceRow.module.css）：
 * 组（L4-17）：标题上 14px/22px + 三卡列 gap 8 / padding 16 0；
 * 卡（themeCube L29-57）：flex 1 1 180 / padding 20 32 / gap 4 / radius 20 /
 * 0.5px border-l4 / 图标上文字下；选中 = module 底 + bluish-400 描边。 */
import { onUnmounted, ref } from 'vue'
import { MxIcon, useService, type ThemeController, type ThemeMode } from '@mindx-work/ui-shell-vue'

const theme = useService<ThemeController>('shell.theme')
const mode = ref<ThemeMode>(theme.mode)
const stop = theme.subscribe((next) => {
  mode.value = next
})
onUnmounted(stop)

const options: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'light', label: '浅色', icon: 'lucide:sun' },
  { value: 'dark', label: '深色', icon: 'lucide:moon' },
  { value: 'auto', label: '跟随系统', icon: 'lucide:monitor' },
]
</script>

<template>
  <div :class="$style.group">
    <div :class="$style.title">外观</div>
    <div :class="$style.cubeRow" role="radiogroup" aria-label="主题外观">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :class="[$style.cube, { [$style.selected]: mode === option.value }]"
        @click="theme.setMode(option.value)"
      >
        <MxIcon :name="option.icon" :size="20" />
        <span>{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

<style module>
/* 组（AppearanceRow L4-17）：标题与三卡纵排 gap 8 / padding 16 0（分隔线由壳行间统一提供） */
.group {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: 16px 0;
}

/* 标题（L12-17）：14px/22px primary */
.title {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.cubeRow {
  display: flex;
  align-items: stretch;
  gap: var(--mx-space-2);
  flex-wrap: wrap;
}

/* 卡（themeCube L29-46）：flex 1 1 180 / padding 20 32 / gap 4 / radius 20 / 0.5px border-l4 */
.cube {
  box-sizing: border-box;
  flex: 1 1 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-1);
  padding: 20px 32px;
  border: 0.5px solid var(--mx-border-l4);
  border-radius: 20px;
  background: transparent;
  font: var(--mx-font-body);
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

/* hover 非选中（L48-50）：interactive-bg-hover */
.cube:hover:not(.selected) {
  background: var(--mx-hover);
}

.cube:active:not(.selected) {
  background: var(--mx-hover);
}

.cube:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.cube:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 选中（L54-57）：module 底（bluish-60/800）+ bluish-400 描边（L52-53 注释） */
.selected {
  background: var(--mx-module);
  border-color: var(--mx-border-selected);
}
</style>
