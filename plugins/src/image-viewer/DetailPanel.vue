<script setup lang="ts">
/**
 * image-viewer 详情面板：适应宽度直出 + 滚轮缩放（几何仅经 CSS 变量注入动态数值）。
 * 初始 scale=1 即适应容器（img max 约束 contain），滚轮缩放乘系数并夹取范围。
 */
import { computed, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useImageViewerStore } from './store'

const store = useImageViewerStore()

/** 缩放倍率（1 = 适应宽度） */
const scale = ref(1)
const MIN_SCALE = 0.1
const MAX_SCALE = 10

/** 滚轮缩放：上滚放大、下滚缩小（元素级监听，preventDefault 生效） */
function onWheel(e: WheelEvent): void {
  if (!store.dataUrl) return
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))
  scale.value = next
}

/** 重置为适应宽度 */
function resetScale(): void {
  scale.value = 1
}

const scalePercent = computed(() => `${Math.round(scale.value * 100)}%`)

const fileName = computed(() => store.currentFile.split('/').pop() || store.currentFile)
</script>

<template>
  <div :class="$style.panel">
    <!-- 头部：文件名 + 缩放比例 + 重置 -->
    <div :class="$style.header">
      <span :class="$style.fileName" :title="store.currentFile">
        <MxIcon name="lucide:image" :size="16" />
        {{ fileName || '未打开图片' }}
      </span>
      <template v-if="store.dataUrl">
        <span :class="$style.scale">{{ scalePercent }}</span>
        <button
          type="button"
          :class="$style.iconBtn"
          aria-label="重置缩放"
          @click="resetScale"
        >
          <MxIcon name="lucide:maximize" :size="16" />
        </button>
      </template>
    </div>

    <!-- 错误态 -->
    <p v-if="store.error" :class="$style.error">{{ store.error }}</p>

    <!-- 空态 -->
    <p v-else-if="!store.dataUrl && !store.loading" :class="$style.hint">
      尚未打开任何图片
    </p>

    <!-- 画布：滚轮缩放，内容居中 -->
    <div v-else :class="$style.canvas" @wheel="onWheel">
      <img
        v-if="store.dataUrl"
        :src="store.dataUrl"
        :alt="fileName"
        :class="$style.image"
        :style="{ transform: `scale(${scale})` }"
      />
    </div>
  </div>
</template>

<style module>
.panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
}

.header {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-shrink: 0;
}

.fileName {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.scale {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
}

.iconBtn:hover {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.iconBtn:active {
  background: var(--mx-active);
}

.iconBtn:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: 1px;
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  margin: 0;
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}

/* 画布：缩放超出视口时允许滚动查看（scale 后内容大于容器） */
.canvas {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  border-radius: var(--mx-radius-card);
  background: var(--mx-bg-surface);
}

/* scale=1 时适应容器宽高（contain 语义），放大经 transform 溢出滚动 */
.image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
}
</style>
