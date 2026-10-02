<script setup lang="ts">
/**
 * FloaterPane：可拖动浮窗（契约第 4 节 Floater 视图区）。
 * 无传统 titlebar：头部为细带——左侧模拟 macOS 交通灯（仅红灯，点击关闭）+
 * 标题小字；风格对齐主窗浮层族（elevated 底 / window 圆角 / shadow-lv3 锐利边界）。
 * 多条目并存、无遮罩不阻塞、不抢 Esc（关闭通道 = 红灯 / 注册者自行 remove）。
 * 位置归适配层本地状态（拖动实时更新，clamp 保持头部可抓；刷新重置，持久化待定）。
 */
import { computed, reactive, ref, useCssModule, watch } from 'vue'
import { useShell, useShellData } from '../reactivity'

/** 缺省尺寸（适配器本地常量不上抛初始值，对齐 SIDEBAR_DEFAULT 先例） */
const WIDTH_DEFAULT = 360
const HEIGHT_DEFAULT = 480
/** 头部细带高度（拖动手柄 + 交通灯载体） */
const HEADER_H = 36

const shell = useShell()
const data = useShellData(() => shell.Floater.entries)

/** 每条目浮窗位置（键为条目 id） */
const positions = reactive(new Map<string, { x: number; y: number }>())
/** 点击置顶：展示顺序即同层叠放次序（DOM 顺序，越靠后越上层） */
const frontOrder = ref<string[]>([])

// 新条目初始化位置：右下角错位叠放；条目移除时清理状态
// （watch 声明在 positions/frontOrder 之后，规避 immediate 回调 TDZ）
watch(
  data,
  (entries) => {
    for (const entry of entries) {
      if (positions.has(entry.id)) continue
      const w = entry.width ?? WIDTH_DEFAULT
      const idx = positions.size
      positions.set(entry.id, {
        x: Math.max(16, window.innerWidth - w - 32 - (idx % 5) * 24),
        y: 96 + (idx % 5) * 28,
      })
    }
    for (const id of positions.keys()) {
      if (!entries.some((entry) => entry.id === id)) positions.delete(id)
    }
  },
  { immediate: true },
)

/** 展示顺序：按置顶秩排序（未置顶的保持注册序，sort 稳定） */
const ordered = computed(() => {
  const rank = new Map(frontOrder.value.map((id, i) => [id, i]))
  return data.value.slice().sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1))
})

function bringToFront(id: string) {
  if (frontOrder.value[frontOrder.value.length - 1] === id) return
  frontOrder.value = [...frontOrder.value.filter((x) => x !== id), id]
}

function styleOf(entry: (typeof data.value)[number]) {
  const pos = positions.get(entry.id)
  return {
    left: `${pos?.x ?? 0}px`,
    top: `${pos?.y ?? 0}px`,
    width: `${entry.width ?? WIDTH_DEFAULT}px`,
    height: `${entry.height ?? HEIGHT_DEFAULT}px`,
  }
}

/** 拖动会话：头部 pointerdown 开始，setPointerCapture 后 move 持续派发到头部 */
let drag: { id: string; dx: number; dy: number } | null = null

function onHeaderDown(event: PointerEvent, id: string) {
  const pos = positions.get(id)
  if (!pos || event.button !== 0) return
  drag = { id, dx: event.clientX - pos.x, dy: event.clientY - pos.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onHeaderMove(event: PointerEvent) {
  if (!drag) return
  const pos = positions.get(drag.id)
  const entry = data.value.find((item) => item.id === drag!.id)
  if (!pos || !entry) return
  const w = entry.width ?? WIDTH_DEFAULT
  // clamp：头部细带始终留在窗口内可抓取（x 允许左右探出，仅保留 60px 头部）
  pos.x = Math.min(window.innerWidth - 60, Math.max(-(w - 60), event.clientX - drag.dx))
  pos.y = Math.min(window.innerHeight - HEADER_H, Math.max(0, event.clientY - drag.dy))
}

function onHeaderUp() {
  drag = null
}

/** 出现/消失动画预设分发（缺省 zoom）：入场为动态类，退场为 Transition 动态
 * leave-active-class（v-for 每条目独立 Transition，prop 可按条目选择）。
 * script 内经 useCssModule 取模块类（$style 仅模板作用域自动可用） */
const styles = useCssModule()

function enterClassOf(entry: (typeof data.value)[number]) {
  const anim = entry.animation ?? 'zoom'
  if (anim === 'fade') return styles.floatFadeIn
  if (anim === 'none') return undefined
  return styles.floatZoomIn
}

function leaveClassOf(entry: (typeof data.value)[number]) {
  const anim = entry.animation ?? 'zoom'
  if (anim === 'fade') return styles.floatFadeLeave
  if (anim === 'none') return undefined
  return styles.floatZoomLeave
}
</script>

<template>
  <Transition
    v-for="entry in ordered"
    :key="entry.id"
    :leave-active-class="leaveClassOf(entry)"
  >
    <div
      v-if="data.some((item) => item.id === entry.id)"
      :class="[$style.floatRoot, enterClassOf(entry)]"
      :style="styleOf(entry)"
      @pointerdown.capture="bringToFront(entry.id)"
    >
      <header
        :class="$style.floatHeader"
        @pointerdown="onHeaderDown($event, entry.id)"
        @pointermove="onHeaderMove"
        @pointerup="onHeaderUp"
        @pointercancel="onHeaderUp"
      >
        <!-- 壳机制固有关闭控件：模拟 macOS 交通灯（仅红灯），关闭 = 移除条目 -->
        <button
          type="button"
          :class="$style.trafficClose"
          aria-label="关闭"
          @pointerdown.stop
          @click="shell.Floater.remove(entry.id)"
        />
        <span :class="$style.floatTitle">{{ entry.title }}</span>
      </header>
      <div :class="$style.floatBody">
        <component :is="entry.component" />
      </div>
    </div>
  </Transition>
</template>

<style module>
/* 浮窗根：风格对齐主窗浮层族——elevated 底 / window 圆角 / shadow-lv3 首段
 * 1px 实色描边保证锐利边界（modal 卡先例）；overflow hidden 裁内容于圆角内。
 * z-index 55：任何浮层族之下（设置 60 / sheet 62 / 通知 65 / modal 70 / menu 100
 * 都盖得住浮窗），Content 基准层之上。入场动画经动态类按条目 animation 预设提供 */
.floatRoot {
  position: fixed;
  z-index: 55;
  display: flex;
  flex-direction: column;
  background: var(--mx-bg-elevated);
  border-radius: var(--mx-radius-window);
  box-shadow: var(--mx-shadow-lv3);
  overflow: hidden;
}

/* 头部细带（壳固有 chrome）：交通灯 + 标题，按住拖动 */
.floatHeader {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  height: 36px;
  padding: 0 var(--mx-space-3);
  border-bottom: 1px solid var(--mx-separator-soft);
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.floatHeader:active {
  cursor: grabbing;
}

/* 模拟 macOS 交通灯：仅红灯，12px 圆点；悬停显现 × 提示关闭 */
.trafficClose {
  flex: none;
  width: 12px;
  height: 12px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--mx-traffic-light-close);
  position: relative;
  cursor: default;
}

.trafficClose::after {
  content: '×';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  color: color-mix(in srgb, var(--mx-traffic-light-close) 35%, black);
  opacity: 0;
  transition: opacity var(--mx-duration-fast) linear;
}

.trafficClose:hover::after {
  opacity: 1;
}

/* 标题：红灯右侧小字（工具窗心智） */
.floatTitle {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 500;
  color: var(--mx-text);
}

/* 本体：注册者组件填充剩余空间，超高滚动 */
.floatBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 出现/消失动画预设（缺省 zoom）：
 * zoom = 放大出现、缩小消失（对齐对话框 Apple 动画定稿：scale 0.82，标准曲线） */
@keyframes float-zoom-in {
  from {
    opacity: 0;
    transform: scale(0.82);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes float-zoom-out {
  from {
    opacity: 1;
    transform: none;
  }
  to {
    opacity: 0;
    transform: scale(0.82);
  }
}

/* fade = 纯淡入淡出 */
@keyframes float-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes float-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

/* 入场类（随元素常驻，animationend 后停在 to 帧） */
.floatZoomIn {
  animation: float-zoom-in var(--mx-duration-motion) var(--mx-ease-standard);
}

.floatFadeIn {
  animation: float-fade-in var(--mx-duration-motion) var(--mx-ease-standard);
}

/* 退场挂载类：Transition 加在浮窗根元素上，animationend 后才真正卸载；
 * none 预设无退场类 → 无动画时长即瞬时卸载。
 * 置于文件末尾以覆盖常驻入场动画（同 specificity 后定义者胜） */
.floatZoomLeave {
  animation: float-zoom-out var(--mx-duration-motion) var(--mx-ease-standard) forwards;
}

.floatFadeLeave {
  animation: float-fade-out var(--mx-duration-motion) var(--mx-ease-standard) forwards;
}

/* 动效只用于状态过渡；偏好减弱动效时关闭入场/退场动画（退场无动画时长即瞬时卸载） */
@media (prefers-reduced-motion: reduce) {
  .floatZoomIn,
  .floatFadeIn,
  .floatZoomLeave,
  .floatFadeLeave {
    animation: none;
  }
}
</style>
