<script setup lang="ts">
/**
 * 小地图：画布区右下角悬浮，显示文档边界/内容 bbox/当前视口三层矩形，
 * 点击或拖动跳转视口（视口中心 = 指针点）。内容 bbox 由父组件算好传入。
 */
import { computed, ref } from 'vue'
import type { View } from './types'

const props = defineProps<{ docBox: View; contentBox: View | null; view: View }>()
const emit = defineEmits(['navigate'])

/** 小地图世界范围：文档 ∪ 内容，外扩 8% 边距 */
const world = computed<View>(() => {
  const a = props.docBox
  const b = props.contentBox
  const x = Math.min(a.x, b?.x ?? a.x)
  const y = Math.min(a.y, b?.y ?? a.y)
  const r = Math.max(a.x + a.w, b ? b.x + b.w : a.x + a.w)
  const bm = Math.max(a.y + a.h, b ? b.y + b.h : a.y + a.h)
  const w = r - x
  const h = bm - y
  return { x: x - w * 0.08, y: y - h * 0.08, w: w * 1.16, h: h * 1.16 }
})

/** 小地图内 svg 元素（指针坐标换算基准） */
const mapEl = ref<SVGSVGElement | null>(null)

/** 指针位置 → 小地图世界坐标，emit 视口中心点 */
function navigateTo(e: PointerEvent): void {
  const box = mapEl.value?.getBoundingClientRect()
  if (!box) return
  const w = world.value
  emit('navigate', {
    x: ((e.clientX - box.left) / box.width) * w.w + w.x,
    y: ((e.clientY - box.top) / box.height) * w.h + w.y,
  })
}

/** 按下态：仅按下期间拖动导航（悬停划过不劫持主视口） */
let pressing = false

/** 拖动跳转：pointerdown 起捕获，move 持续导航 */
function onDown(e: PointerEvent): void {
  mapEl.value?.setPointerCapture(e.pointerId)
  pressing = true
  navigateTo(e)
}

/** 按下期间移动才导航 */
function onMove(e: PointerEvent): void {
  if (pressing) navigateTo(e)
}

/** 抬起/取消/划出复位按下态 */
function onUp(): void {
  pressing = false
}
</script>

<template>
  <div :class="$style.map">
    <svg
      ref="mapEl"
      :viewBox="`${world.x} ${world.y} ${world.w} ${world.h}`"
      :class="$style.svg"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onUp"
    >
      <!-- 文档边界：白底框 -->
      <rect :x="docBox.x" :y="docBox.y" :width="docBox.w" :height="docBox.h" :class="$style.docRect" />
      <!-- 内容范围：半透明填充 -->
      <rect
        v-if="contentBox"
        :x="contentBox.x"
        :y="contentBox.y"
        :width="contentBox.w"
        :height="contentBox.h"
        :class="$style.contentRect"
      />
      <!-- 当前视口：accent 描边 -->
      <rect :x="view.x" :y="view.y" :width="view.w" :height="view.h" :class="$style.viewRect" />
    </svg>
  </div>
</template>

<style module>
.map {
  position: absolute;
  right: var(--mx-space-3);
  bottom: var(--mx-space-3);
  z-index: 2;
  width: 160px;
  height: 110px;
  padding: 3px;
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-control);
  /* 浮层叠在白色画布上：对齐 shapesPanel 先例用近不透明底 */
  background: var(--mx-menu-bg-opaque);
  box-shadow: var(--mx-shadow-prominent);
}

.svg {
  width: 100%;
  height: 100%;
  cursor: pointer;
  touch-action: none;
}

.docRect {
  fill: #ffffff;
  stroke: var(--mx-border-strong);
  stroke-width: 1;
}

.contentRect {
  fill: var(--mx-hover);
  stroke: none;
}

.viewRect {
  fill: none;
  stroke: var(--mx-accent);
  stroke-width: 1;
}
</style>
