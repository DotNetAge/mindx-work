<script setup lang="ts">
/**
 * 缩放控件：画布区左下角悬浮，缩小/百分比/放大/适应内容。
 * 百分比由父组件传入（view 态在父），本组件纯展示 + 事件。
 */
import { MxIcon } from '@mindx-work/ui-shell-vue'

defineProps<{ percent: number }>()
const emit = defineEmits(['zoomIn', 'zoomOut', 'fit'])
</script>

<template>
  <div :class="$style.zoom">
    <button type="button" :class="$style.btn" aria-label="缩小" title="缩小" @click="emit('zoomOut')">
      <MxIcon name="lucide:zoom-out" :size="16" />
    </button>
    <span :class="$style.value">{{ percent }}%</span>
    <button type="button" :class="$style.btn" aria-label="放大" title="放大" @click="emit('zoomIn')">
      <MxIcon name="lucide:zoom-in" :size="16" />
    </button>
    <button type="button" :class="$style.btn" aria-label="适应内容" title="适应内容" @click="emit('fit')">
      <MxIcon name="lucide:maximize" :size="16" />
    </button>
  </div>
</template>

<style module>
.zoom {
  position: absolute;
  left: var(--mx-space-3);
  bottom: var(--mx-space-3);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-control);
  /* 浮层叠在白色画布上：对齐 shapesPanel 先例用近不透明底 */
  background: var(--mx-menu-bg-opaque);
  box-shadow: var(--mx-shadow-prominent);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-secondary);
  cursor: pointer;
}

.btn:hover {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.btn:active {
  background: var(--mx-active);
}

.btn:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: -1px;
}

.value {
  min-width: 44px;
  text-align: center;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
