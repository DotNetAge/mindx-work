<script setup lang="ts">
// 通用环形进度指示器（r=8 圆弧 + stroke-dasharray，圆头端点，-90° 起始）。
// 源：mindx-desktop components/common/ProgressRing.vue（二期 B 平移）——
// 与 RoundFooter 的上下文用量环同款视觉。
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    percent: number // 0-100
    color?: string // 前景弧颜色
    trackColor?: string // 底环颜色
    label?: string // 环旁文字（如百分比），不传则只显示环
    size?: number // 显示尺寸 px（viewBox 固定 20）
    strokeWidth?: number
  }>(),
  // desktop 默认 focusBorder → work 品牌主色 --mx-accent（附录 A：单品牌色语义）
  // desktop 默认 --border-color → --mx-separator（附录 A）
  { color: 'var(--mx-accent)', trackColor: 'var(--mx-separator)', size: 16, strokeWidth: 2 }
)

const CIRCUMFERENCE = 2 * Math.PI * 8 // r=8

const ringDash = computed(() => {
  const ratio = Math.min(Math.max(props.percent, 0), 100) / 100
  const filled = CIRCUMFERENCE * ratio
  return `${filled} ${CIRCUMFERENCE - filled}`
})
</script>

<template>
  <div class="progress-ring-wrapper">
    <svg class="progress-ring" :width="size" :height="size" viewBox="0 0 20 20">
      <!-- 底环 -->
      <circle cx="10" cy="10" r="8" fill="none" :stroke="trackColor" :stroke-width="strokeWidth" />
      <!-- 前景弧 -->
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        :stroke="color"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        :stroke-dasharray="ringDash"
        transform="rotate(-90 10 10)"
        class="progress-ring-arc"
      />
    </svg>
    <span v-if="label" class="progress-ring-label" :style="{ color }">{{ label }}</span>
  </div>
</template>

<style scoped>
.progress-ring-wrapper {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.progress-ring {
  display: block;
  flex-shrink: 0;
}

.progress-ring-arc {
  transition: stroke-dasharray 0.6s ease, stroke 0.3s ease;
}

.progress-ring-label {
  font: var(--mx-font-micro);
  font-family: var(--mx-font-mono);
  font-weight: 700;
  line-height: 1;
  transition: color 0.3s ease;
}
</style>
