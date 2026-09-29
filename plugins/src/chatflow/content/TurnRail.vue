<script setup lang="ts">
/**
 * TurnRail：对话流左侧轮次指示器（豆包同款「波浪刻度尺」）。
 *
 * 机制（按豆包效果反推还原）：
 * - 每轮一根 2px 圆角刻度，行 flex:1 均分 rail 高度（轮次再多也放得下），
 *   刻度左端锚定侧栏侧、向右伸长（伸入内容区方向）；
 * - 波浪：mousemove 记录鼠标 Y → 每根刻度目标宽度按与鼠标距离高斯衰减
 *   （近长远短、向两端连续递减）→ rAF 每帧向目标插值（lerp）。
 *   插值造成的各刻度响应时差即「波浪拖尾」；直接赋值只会生硬跟手
 *   （prefers-reduced-motion 时退化为直接赋值）；
 * - 最近刻度高亮并弹 tooltip（轮次序号 + 摘要）；
 * - activeIndex 由父级按滚动位置计算传入，常驻指示当前所在轮；
 * - 点击刻度上抛 select(key)，渲染窗扩窗与滚动定位由父级处理。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface RailRound {
  key: string
  title: string
}

const props = defineProps<{
  rounds: RailRound[]
  activeIndex: number
}>()

const emit = defineEmits<{ select: [key: string] }>()

/* 波浪参数：基准宽 / 插值系数（越小拖尾越长；1 = 无插值直接跟手） */
const BASE_W = 12
const LERP = 0.18
const lerpStep = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : LERP

const railRef = ref<HTMLElement | null>(null)
/** 每根刻度当前宽度（非响应式：rAF 直写 DOM，绕开 Vue 响应开销） */
let widths: number[] = []
let mouseY = -1
let rafId = 0
/** hover 最近行索引与 tooltip 垂直位置（rail 内坐标） */
const nearIndex = ref(-1)
const tipTop = ref(0)

const tipRound = computed(
  () => (nearIndex.value >= 0 ? props.rounds[nearIndex.value] ?? null : null)
)

function frame() {
  rafId = requestAnimationFrame(frame)
  const rail = railRef.value
  if (!rail) return
  const rows = rail.children
  const n = rows.length
  if (n === 0) return
  // 刻度数随轮次增减：重建宽度表（保留旧值，追加轮不闪回基准宽）
  if (widths.length !== n) {
    const next = new Array<number>(n).fill(BASE_W)
    for (let i = 0; i < Math.min(widths.length, n); i++) next[i] = widths[i] ?? BASE_W
    widths = next
  }
  // 行距自适应（σ/峰值随实测行距伸缩，轮次密集时波浪收窄）
  const rowH = (rows[0] as HTMLElement).offsetHeight || 14
  const sigma = Math.max(16, Math.min(40, rowH * 1.6))
  const add = Math.max(10, Math.min(22, rowH * 1.4))
  let bestD = Infinity
  let bestI = -1
  let bestCenter = 0
  for (let i = 0; i < n; i++) {
    const row = rows[i] as HTMLElement
    const center = row.offsetTop + row.offsetHeight / 2
    const d = Math.abs(center - mouseY)
    const target =
      mouseY >= 0 ? BASE_W + add * Math.exp(-(d * d) / (2 * sigma * sigma)) : BASE_W
    const cur = widths[i] ?? BASE_W
    const w = cur + (target - cur) * lerpStep
    widths[i] = w
    const tick = row.firstElementChild as HTMLElement | null
    if (tick) tick.style.width = `${w.toFixed(2)}px`
    if (mouseY >= 0 && d < bestD) {
      bestD = d
      bestI = i
      bestCenter = center
    }
  }
  // 最近刻度：距离不超过约 3/4 行距才高亮（rail 上下端外悬浮不误亮）
  const hi = mouseY >= 0 && bestD <= rowH * 0.75 ? bestI : -1
  if (hi !== nearIndex.value) nearIndex.value = hi
  if (hi >= 0) {
    const h = rail.clientHeight
    tipTop.value = Math.max(14, Math.min(h - 14, bestCenter))
  }
}

function handleMove(e: MouseEvent) {
  const rail = railRef.value
  if (!rail) return
  mouseY = e.clientY - rail.getBoundingClientRect().top
}

/** 行高：固定行距优先（豆包观感），轮次多到撑不下才按 rail 高度压缩 */
function updateRowHeight() {
  const rail = railRef.value
  if (!rail) return
  const h = rail.clientHeight
  const n = props.rounds.length
  if (h <= 0 || n === 0) return
  rail.style.setProperty('--rail-row-h', `${Math.min(14, Math.max(6, h / n))}px`)
}

function handleLeave() {
  mouseY = -1
  nearIndex.value = -1
}

/** 事件委托：点击行 → 上抛该轮 key */
function handleClick(e: MouseEvent) {
  const row = (e.target as HTMLElement).closest('[data-idx]') as HTMLElement | null
  if (!row) return
  const round = props.rounds[Number(row.dataset.idx)]
  if (round) emit('select', round.key)
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  updateRowHeight()
  resizeObserver = new ResizeObserver(updateRowHeight)
  resizeObserver.observe(railRef.value!)
  rafId = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
})

// 轮次增减 → 行高重算（DOM 提交后量 rail 高度）
watch(() => props.rounds.length, () => nextTick(updateRowHeight))
</script>

<template>
  <nav
    ref="railRef"
    :class="$style.rail"
    aria-label="轮次导航"
    @mousemove="handleMove"
    @mouseleave="handleLeave"
    @click="handleClick"
  >
    <div v-for="(r, i) in rounds" :key="r.key" :data-idx="i" :class="$style.row">
      <span
        :class="[
          $style.tick,
          { [$style.near]: i === nearIndex, [$style.active]: i === activeIndex },
        ]"
      />
    </div>
    <div v-if="tipRound" :class="$style.tip" :style="{ top: `${tipTop}px` }">
      <span :class="$style.tipIndex">第 {{ nearIndex + 1 }} 轮</span>
      <span :class="$style.tipTitle">{{ tipRound.title }}</span>
    </div>
  </nav>
</template>

<style module>
/* rail：浮于消息流左侧（streamWrap 为定位锚点），上下留白一档；
   刻度行固定行距（--rail-row-h）且整列垂直居中——轮次少时短居中一段，
   多时按 rail 高度压缩行距，均不会溢出 */
.rail {
  position: absolute;
  left: var(--mx-space-2);
  top: var(--mx-space-6);
  bottom: var(--mx-space-6);
  width: 44px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.row {
  flex: 0 0 auto;
  height: var(--rail-row-h, 14px);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  cursor: pointer;
}

/* 刻度本体：2px 圆角条，宽度由 rAF 直写（波浪），颜色随状态 */
.tick {
  display: block;
  height: 2px;
  border-radius: 999px;
  background: var(--mx-text-caption);
  will-change: width;
  transition: background-color var(--mx-duration-fast) ease;
}

/* hover 最近：前景亮色（豆包同款白色高亮） */
.near {
  background: var(--mx-text);
}

/* 当前滚动所在轮：品牌色常驻 */
.active {
  background: var(--mx-accent);
}

/* tooltip：跟随最近刻度，悬浮在 rail 右侧内容之上（豆包同款位置）；
   恒暗 hovercard 底 + 硬边界阴影，无模糊 */
.tip {
  position: absolute;
  left: calc(100% - var(--mx-space-2));
  transform: translateY(-50%);
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-2);
  max-width: 320px;
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  background: var(--mx-hovercard-bg);
  color: var(--mx-static-white);
  box-shadow: var(--mx-shadow-lv3);
  pointer-events: none;
  white-space: nowrap;
}

.tipIndex {
  flex-shrink: 0;
  font: var(--mx-font-micro);
  color: var(--mx-text-caption);
}

.tipTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  font: var(--mx-font-caption);
}

/* 消息流过窄（rail 会压住内容）时整根隐藏：容器查询锚在 streamWrap 上。
   断点 = 内容 920 + 双侧 28 边距 + rail 占用 50px + 少量余量（1024 对齐 mx 断点 sm） */
@container chatflow-stream (max-width: 1023px) {
  .rail {
    display: none;
  }
}
</style>
