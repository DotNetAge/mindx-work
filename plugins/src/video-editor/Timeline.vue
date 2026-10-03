<script setup lang="ts">
/**
 * 多轨时间线：刻度尺（scrub 定位播放头）+ 轨道行（轨头静音/隐藏 + 片段区）。
 * 片段拖拽：按住主体移动（store.moveClip：吸附 + 碰撞拒绝）、按住左右缘 6px
 * 热区裁剪（store.trimClip：素材边界约束）。横向缩放（pxPerSec）与分割
 * （按钮 / S 键，播放头处）齐备。片段定位 = left = start × pxPerSec。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useVideoEditorStore } from './store'
import { formatTime, type Clip, type Track } from './types'

const store = useVideoEditorStore()

/** 轨头宽（与样式列宽一致） */
const TRACK_HEAD_W = 96

/** 刻度主格步长：目标 ≥70px 一格（从候选里取首个达标项） */
const niceStep = computed(() => {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return candidates.find((s) => s * store.pxPerSec >= 70) ?? 900
})

/** 刻度数组（覆盖可视时间域：总时长 + 尾部缓冲） */
const ticks = computed(() => {
  const domain = Math.max(store.duration + 10, 60)
  const list: number[] = []
  for (let t = 0; t <= domain; t += niceStep.value) list.push(t)
  return list
})

/** 片段区总宽（px）：时间域 + 尾部缓冲 */
const rulerWidth = computed(() => Math.max(store.duration + 10, 60) * store.pxPerSec + 40)

const scrollRef = ref<HTMLElement | null>(null)

// ── 播放头 scrub（刻度尺按住拖动）────────────────────────────────────────────
let scrubbing = false

function timeAt(clientX: number): number {
  const el = scrollRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const x = clientX - rect.left + el.scrollLeft - TRACK_HEAD_W
  return Math.max(0, x / store.pxPerSec)
}

function onRulerDown(event: PointerEvent): void {
  if (store.exporting) return
  scrubbing = true
  ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  store.seek(timeAt(event.clientX))
}

function onRulerMove(event: PointerEvent): void {
  if (!scrubbing) return
  store.seek(timeAt(event.clientX))
}

function onRulerUp(): void {
  scrubbing = false
}

// ── 片段拖拽（移动 / 裁剪）───────────────────────────────────────────────────

interface DragState {
  mode: 'move' | 'in' | 'out'
  clipId: string
  trackId: string
  startClientX: number
  baseStart: number
  baseEnd: number
}

let drag: DragState | null = null

/** 边缘热区（px，两侧各 6px 为裁剪柄） */
const EDGE_HOT = 6

function onClipDown(event: PointerEvent, track: Track, clip: Clip): void {
  if (store.exporting) return
  store.selectedClipId = clip.id
  const target = event.target as HTMLElement
  const rect = target.getBoundingClientRect()
  const offsetX = event.clientX - rect.left
  let mode: DragState['mode'] = 'move'
  if (offsetX <= EDGE_HOT) mode = 'in'
  else if (offsetX >= rect.width - EDGE_HOT) mode = 'out'
  drag = {
    mode,
    clipId: clip.id,
    trackId: track.id,
    startClientX: event.clientX,
    baseStart: clip.start,
    baseEnd: clip.start + clip.duration,
  }
  target.setPointerCapture(event.pointerId)
}

function onClipMove(event: PointerEvent): void {
  if (!drag) return
  const dt = (event.clientX - drag.startClientX) / store.pxPerSec
  if (drag.mode === 'move') {
    store.moveClip(drag.clipId, drag.trackId, drag.baseStart + dt)
  } else if (drag.mode === 'in') {
    store.trimClip(drag.clipId, 'in', drag.baseStart + dt)
  } else {
    store.trimClip(drag.clipId, 'out', drag.baseEnd + dt)
  }
}

function onClipUp(): void {
  drag = null
}

// ── 片段外观 ────────────────────────────────────────────────────────────────

function clipStyle(clip: Clip): Record<string, string> {
  return {
    left: `${clip.start * store.pxPerSec}px`,
    width: `${Math.max(8, clip.duration * store.pxPerSec)}px`,
  }
}

/** 媒体片段缩略图（取素材封面；音频 / 无封面走图标） */
function thumbOf(clip: Clip): string {
  if (clip.type !== 'media') return ''
  return store.resolveAsset(clip.assetId)?.thumb ?? ''
}

const selectedId = computed(() => store.selectedClipId)

// ── S 键分割 ────────────────────────────────────────────────────────────────

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
  if (event.key === 's' || event.key === 'S') {
    store.splitAtPlayhead()
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div :class="$style.wrap">
    <div :class="$style.tools">
      <span :class="$style.time">{{ formatTime(store.playhead) }}</span>
      <button type="button" class="mx-btn" :class="$style.toolBtn" title="在播放头处分割" :disabled="store.exporting" @click="store.splitAtPlayhead()">
        <MxIcon name="lucide:scissors" :size="16" />
      </button>
      <span :class="$style.spacer" />
      <button type="button" class="mx-icon-btn" aria-label="缩小" @click="store.pxPerSec = Math.max(10, store.pxPerSec / 1.5)">
        <MxIcon name="lucide:zoom-out" :size="16" />
      </button>
      <button type="button" class="mx-icon-btn" aria-label="放大" @click="store.pxPerSec = Math.min(300, store.pxPerSec * 1.5)">
        <MxIcon name="lucide:zoom-in" :size="16" />
      </button>
    </div>

    <div ref="scrollRef" :class="$style.scroll">
      <div :class="$style.inner" :style="{ width: `${rulerWidth}px` }">
        <!-- 刻度尺（scrub 区）；pointercancel 与 pointerup 共用清理函数（系统手势
             抢占指针后不再派发 pointerup，不清理会残留 scrubbing 拖漂移） -->
        <div
          :class="$style.ruler"
          @pointerdown="onRulerDown"
          @pointermove="onRulerMove"
          @pointerup="onRulerUp"
          @pointercancel="onRulerUp"
        >
          <span :class="$style.rulerPad" />
          <div :class="$style.rulerTrack">
            <span
              v-for="t in ticks"
              :key="t"
              :class="$style.tick"
              :style="{ left: `${t * store.pxPerSec}px` }"
            >
              {{ formatTime(t) }}
            </span>
          </div>
        </div>

        <!-- 轨道行 -->
        <div v-for="track in store.project.tracks" :key="track.id" :class="$style.trackRow">
          <div :class="$style.trackHead">
            <MxIcon
              :name="track.kind === 'video' ? 'lucide:film' : track.kind === 'audio' ? 'lucide:audio-lines' : 'lucide:type'"
              :size="16"
            />
            <span :class="$style.trackName">{{ track.name }}</span>
            <button
              type="button"
              class="mx-icon-btn"
              :class="{ [$style.flagActive]: track.muted }"
              :aria-label="track.muted ? '取消静音' : '静音'"
              @click="store.toggleTrackFlag(track.id, 'muted')"
            >
              <MxIcon :name="track.muted ? 'lucide:volume-x' : 'lucide:volume-2'" :size="16" />
            </button>
            <button
              v-if="track.kind === 'video'"
              type="button"
              class="mx-icon-btn"
              :class="{ [$style.flagActive]: track.hidden }"
              :aria-label="track.hidden ? '显示轨道' : '隐藏轨道'"
              @click="store.toggleTrackFlag(track.id, 'hidden')"
            >
              <MxIcon :name="track.hidden ? 'lucide:eye-off' : 'lucide:eye'" :size="16" />
            </button>
          </div>
          <div :class="$style.trackArea">
            <div
              v-for="clip in track.clips"
              :key="clip.id"
              :class="$style.clip"
              :data-kind="clip.type"
              :data-selected="clip.id === selectedId ? 'yes' : 'no'"
              :style="clipStyle(clip)"
              @pointerdown="onClipDown($event, track, clip)"
              @pointermove="onClipMove"
              @pointerup="onClipUp"
              @pointercancel="onClipUp"
            >
              <img v-if="clip.type === 'media' && thumbOf(clip)" :src="thumbOf(clip)" :class="$style.clipThumb" alt="" />
              <span :class="$style.clipLabel">
                <template v-if="clip.type === 'media'">{{ store.resolveAsset(clip.assetId)?.name ?? '媒体' }}</template>
                <template v-else-if="clip.type === 'text'">{{ clip.text }}</template>
                <template v-else>{{ clip.emoji }} 贴纸</template>
              </span>
            </div>
          </div>
        </div>

        <!-- 播放头 -->
        <div :class="$style.playhead" :style="{ left: `${TRACK_HEAD_W + store.playhead * store.pxPerSec}px` }" />
      </div>
    </div>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--mx-bg-window);
}

.tools {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) var(--mx-space-4);
  border-bottom: 0.5px solid var(--mx-separator);
}

.time {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  font-variant-numeric: tabular-nums;
  min-width: 56px;
}

.toolBtn {
  padding: 4px 8px;
}

.spacer {
  flex: 1;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.inner {
  position: relative;
  min-height: 100%;
}

/* ── 刻度尺 ─────────────────────────────────────────────────────────────── */
.ruler {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  height: 28px;
  background: var(--mx-bg-surface);
  border-bottom: 0.5px solid var(--mx-separator);
  cursor: ew-resize;
  user-select: none;
}

.rulerPad {
  width: 96px;
  flex: none;
  border-right: 0.5px solid var(--mx-separator);
}

.rulerTrack {
  position: relative;
  flex: 1;
}

.tick {
  position: absolute;
  top: 2px;
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
  padding-left: 4px;
  border-left: 1px solid var(--mx-separator);
  height: 100%;
}

/* ── 轨道行 ─────────────────────────────────────────────────────────────── */
.trackRow {
  display: flex;
  height: 44px;
  border-bottom: 0.5px solid var(--mx-separator);
}

.trackHead {
  width: 96px;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  padding: 0 var(--mx-space-2);
  color: var(--mx-text-secondary);
  background: var(--mx-bg-surface);
  border-right: 0.5px solid var(--mx-separator);
}

.trackName {
  flex: 1;
  font: var(--mx-font-micro);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flagActive {
  color: var(--mx-state-warn-label);
}

.trackArea {
  position: relative;
  flex: 1;
}

/* ── 片段 ───────────────────────────────────────────────────────────────── */
.clip {
  position: absolute;
  top: 6px;
  bottom: 6px;
  border-radius: var(--mx-radius-control);
  background: var(--mx-module);
  border: 1px solid var(--mx-border-strong);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  display: flex;
  align-items: center;
}

.clip:active {
  cursor: grabbing;
}

.clip:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.clip[data-kind='media'] {
  background: var(--mx-module);
}

.clip[data-kind='text'] {
  background: var(--mx-hover-solid);
}

.clip[data-kind='sticker'] {
  background: var(--mx-hover-solid);
}

.clip[data-selected='yes'] {
  border-color: var(--mx-accent);
  box-shadow: 0 0 0 1px var(--mx-accent);
}

/* 裁剪热区视觉提示：左右 6px 边缘条（拖缘改长度，拖身移动） */
.clip::before,
.clip::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  z-index: 1;
}

.clip::before {
  left: 0;
  background: linear-gradient(90deg, var(--mx-border-strong), transparent);
}

.clip::after {
  right: 0;
  background: linear-gradient(270deg, var(--mx-border-strong), transparent);
}

.clipThumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.55;
  pointer-events: none;
}

.clipLabel {
  position: relative;
  font: var(--mx-font-micro);
  color: var(--mx-text);
  padding: 0 var(--mx-space-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* ── 播放头 ─────────────────────────────────────────────────────────────── */
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--mx-accent);
  pointer-events: none;
  z-index: 3;
}
</style>
