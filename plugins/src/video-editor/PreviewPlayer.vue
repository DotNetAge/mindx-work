<script setup lang="ts">
/**
 * 预览播放器：画布渲染 + 播放控制。挂载期启动持续 rAF 循环——每帧把项目
 * 状态画到画布（暂停态也画：编辑动作与 seek 后画面即时更新；视频元素播放
 * 中的动态帧依赖每帧重画）。画布按项目分辨率设定，CSS 等比缩放适配容器。
 * 底部控制行：播放/暂停、播放头时间、总时长、画面轨显隐不在此处（轨道上）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useVideoEditorStore } from './store'
import { renderFrame } from './engine/render'
import { formatTime } from './types'

const store = useVideoEditorStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let rafId = 0

/** 持续渲染循环：每帧重画（渲染实现与导出共用 renderFrame）；画布不可见时跳帧防空转 */
function frame(): void {
  const canvas = canvasRef.value
  if (canvas && canvas.offsetParent !== null) {
    const ctx = canvas.getContext('2d')
    if (ctx) {
      renderFrame(ctx, { project: store.project, pool: store.pool, resolve: store.resolveAsset }, store.playhead)
    }
  }
  rafId = requestAnimationFrame(frame)
}

onMounted(() => {
  rafId = requestAnimationFrame(frame)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  // Detail 卸载（切走 / 收起）即暂停：界面消失后不应有看不见的播放继续出声
  if (store.playing) store.togglePlay()
})

const totalLabel = computed(() => formatTime(store.duration))
const headLabel = computed(() => formatTime(store.playhead))
</script>

<template>
  <div :class="$style.wrap">
    <div :class="$style.stage">
      <canvas
        ref="canvasRef"
        :width="store.project.width"
        :height="store.project.height"
        :class="$style.canvas"
      />
      <div v-if="store.project.assets.length === 0" :class="$style.empty">
        <MxIcon name="lucide:clapperboard" :size="20" />
        <span>从左侧导入素材开始剪辑</span>
      </div>
    </div>
    <div :class="$style.controls">
      <button
        type="button"
        class="mx-icon-btn"
        :aria-label="store.playing ? '暂停' : '播放'"
        @click="store.togglePlay()"
      >
        <MxIcon :name="store.playing ? 'lucide:pause' : 'lucide:play'" :size="16" />
      </button>
      <span :class="$style.time" class="mx-tag" data-tone="quiet">
        {{ headLabel }} / {{ totalLabel }}
      </span>
      <span :class="$style.spacer" />
      <span :class="$style.res">{{ store.project.width }}×{{ store.project.height }} · {{ store.project.fps }}fps</span>
    </div>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mx-bg-surface);
  overflow: hidden;
}

.canvas {
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: auto;
  object-fit: contain;
  background: #000000;
  border-radius: var(--mx-radius-card);
}

.empty {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mx-space-2);
  color: var(--mx-text-tertiary);
  font: var(--mx-font-caption);
  pointer-events: none;
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-2) var(--mx-space-4);
  border-top: 0.5px solid var(--mx-separator);
}

.time {
  font-variant-numeric: tabular-nums;
}

.spacer {
  flex: 1;
}

.res {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
