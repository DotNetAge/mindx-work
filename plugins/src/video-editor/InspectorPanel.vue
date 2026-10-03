<script setup lang="ts">
/**
 * 属性检查器（右栏）：编辑选中片段的参数。按片段类别分派——媒体片段：
 * 速度 / 音量 / 不透明度 / 滤镜五参 / 转场；文字片段：内容 / 字号 / 颜色 /
 * 描边 / 位置；贴纸片段：表情 / 大小 / 位置。底部通用操作：分割（播放头处）、
 * 复制、删除。无选中时显示引导文案。
 */
import { computed } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useVideoEditorStore } from './store'
import { mediaOutPoint, type MediaClip, type StickerClip, type TextClip, type TransitionType } from './types'

const store = useVideoEditorStore()

const selection = computed(() => {
  if (!store.selectedClipId) return null
  return store.locateClip(store.selectedClipId)
})

const mediaClip = computed(() => (selection.value?.clip.type === 'media' ? (selection.value.clip as MediaClip) : null))
const textClip = computed(() => (selection.value?.clip.type === 'text' ? (selection.value.clip as TextClip) : null))
const stickerClip = computed(() => (selection.value?.clip.type === 'sticker' ? (selection.value.clip as StickerClip) : null))

const TRANSITIONS: Array<{ value: TransitionType; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'fade', label: '淡入' },
  { value: 'dissolve', label: '叠化' },
]

// 文字转场只保留 none/fade：渲染层 dissolve 交叉源仅对媒体片段实现（render.ts
// drawMediaWithTransition），文字选 dissolve 实际等同 fade——从源头不提供该选项
const TEXT_TRANSITIONS: Array<{ value: TransitionType; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'fade', label: '淡入' },
]

/** 选中片段素材信息行（媒体片段显示来源与采出区间） */
const mediaInfo = computed(() => {
  if (!mediaClip.value) return ''
  const asset = store.resolveAsset(mediaClip.value.assetId)
  if (!asset) return ''
  return `${asset.name} · ${mediaOutPoint(mediaClip.value).toFixed(1)}s / ${asset.duration.toFixed(1)}s`
})

/** 数值经 range 输入回写（min/max/step 内约束） */
function num(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' ? value : fallback
}

/** 变速经 store 联动：采样区间不变、时间线时长 = 区间 / 新速度（剪映语义） */
function onSpeedInput(event: Event): void {
  const clip = mediaClip.value
  if (!clip) return
  store.setClipSpeed(clip.id, Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div :class="$style.wrap">
    <div :class="$style.head">
      <span :class="$style.title">属性</span>
    </div>

    <div v-if="!selection" :class="$style.empty">
      <MxIcon name="lucide:mouse-pointer-click" :size="20" />
      <span>在时间线上选择一个片段开始编辑</span>
    </div>

    <div v-else :class="[$style.body, { [$style.locked]: store.exporting }]">
      <!-- ── 媒体片段 ─────────────────────────────────────────────────── -->
      <template v-if="mediaClip">
        <div :class="$style.info">{{ mediaInfo }}</div>

        <label :class="$style.row">
          <span :class="$style.label">速度 {{ mediaClip.speed.toFixed(2) }}× · 时长 {{ mediaClip.duration.toFixed(1) }}s</span>
          <input
            :value="mediaClip.speed"
            type="range"
            min="0.25"
            max="4"
            step="0.05"
            :class="$style.range"
            @input="onSpeedInput"
          />
        </label>

        <label :class="$style.row">
          <span :class="$style.label">音量 {{ Math.round(mediaClip.volume * 100) }}%</span>
          <input
            v-model.number="mediaClip.volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>

        <label :class="$style.row">
          <span :class="$style.label">不透明度 {{ Math.round(mediaClip.opacity * 100) }}%</span>
          <input
            v-model.number="mediaClip.opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>

        <div :class="$style.groupTitle">滤镜</div>
        <label :class="$style.row">
          <span :class="$style.label">亮度</span>
          <input
            v-model.number="mediaClip.filter.brightness"
            type="range"
            min="0.2"
            max="2.5"
            step="0.05"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
        <label :class="$style.row">
          <span :class="$style.label">对比度</span>
          <input
            v-model.number="mediaClip.filter.contrast"
            type="range"
            min="0.2"
            max="2.5"
            step="0.05"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
        <label :class="$style.row">
          <span :class="$style.label">饱和度</span>
          <input
            v-model.number="mediaClip.filter.saturation"
            type="range"
            min="0"
            max="2.5"
            step="0.05"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
        <label :class="$style.row">
          <span :class="$style.label">暖冷调</span>
          <input
            v-model.number="mediaClip.filter.warmth"
            type="range"
            min="-1"
            max="1"
            step="0.05"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
        <label :class="$style.row">
          <span :class="$style.label">模糊</span>
          <input
            v-model.number="mediaClip.filter.blur"
            type="range"
            min="0"
            max="20"
            step="0.5"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>

        <div :class="$style.groupTitle">入场转场</div>
        <div :class="$style.row">
          <select
            v-model="mediaClip.transitionIn.type"
            class="mx-input"
            :class="$style.select"
            @change="store.touch()"
          >
            <option v-for="tr in TRANSITIONS" :key="tr.value" :value="tr.value">{{ tr.label }}</option>
          </select>
        </div>
        <label v-if="mediaClip.transitionIn.type !== 'none'" :class="$style.row">
          <span :class="$style.label">时长 {{ num(mediaClip.transitionIn.duration, 0.5).toFixed(1) }}s</span>
          <input
            v-model.number="mediaClip.transitionIn.duration"
            type="range"
            min="0.2"
            max="2"
            step="0.1"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
      </template>

      <!-- ── 文字片段 ─────────────────────────────────────────────────── -->
      <template v-if="textClip">
        <label :class="$style.rowCol">
          <span :class="$style.label">文字内容</span>
          <textarea v-model="textClip.text" class="mx-input" :class="$style.textarea" rows="3" @change="store.touch()" />
        </label>

        <label :class="$style.row">
          <span :class="$style.label">字号 {{ num(textClip.fontSize, 64) }}</span>
          <input
            v-model.number="textClip.fontSize"
            type="range"
            min="16"
            max="200"
            step="2"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>

        <div :class="$style.rowPair">
          <label :class="$style.rowCol">
            <span :class="$style.label">颜色</span>
            <input v-model="textClip.color" type="color" :class="$style.color" @change="store.touch()" />
          </label>
          <label :class="$style.rowCol">
            <span :class="$style.label">描边</span>
            <input v-model="textClip.strokeColor" type="color" :class="$style.color" @change="store.touch()" />
          </label>
        </div>

        <label :class="$style.row">
          <span :class="$style.label">水平 {{ Math.round(textClip.x * 100) }}%</span>
          <input
            v-model.number="textClip.x"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
        <label :class="$style.row">
          <span :class="$style.label">垂直 {{ Math.round(textClip.y * 100) }}%</span>
          <input
            v-model.number="textClip.y"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>

        <div :class="$style.groupTitle">入场转场</div>
        <div :class="$style.row">
          <select
            v-model="textClip.transitionIn.type"
            class="mx-input"
            :class="$style.select"
            @change="store.touch()"
          >
            <option v-for="tr in TEXT_TRANSITIONS" :key="tr.value" :value="tr.value">{{ tr.label }}</option>
          </select>
        </div>
      </template>

      <!-- ── 贴纸片段 ─────────────────────────────────────────────────── -->
      <template v-if="stickerClip">
        <div :class="$style.emojiPreview">{{ stickerClip.emoji }}</div>

        <label :class="$style.row">
          <span :class="$style.label">大小 {{ num(stickerClip.size, 120) }}</span>
          <input
            v-model.number="stickerClip.size"
            type="range"
            min="32"
            max="360"
            step="4"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>

        <label :class="$style.row">
          <span :class="$style.label">水平 {{ Math.round(stickerClip.x * 100) }}%</span>
          <input
            v-model.number="stickerClip.x"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
        <label :class="$style.row">
          <span :class="$style.label">垂直 {{ Math.round(stickerClip.y * 100) }}%</span>
          <input
            v-model.number="stickerClip.y"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :class="$style.range"
            @change="store.touch()"
          />
        </label>
      </template>

      <!-- ── 通用操作 ─────────────────────────────────────────────────── -->
      <div :class="$style.actions">
        <button type="button" class="mx-btn" :class="$style.danger" @click="store.splitAtPlayhead()">
          <MxIcon name="lucide:scissors" :size="16" />
          分割
        </button>
        <button type="button" class="mx-btn" @click="store.duplicateClip(selection.clip.id)">
          <MxIcon name="lucide:copy" :size="16" />
          复制
        </button>
        <button type="button" class="mx-btn" :class="$style.danger" @click="store.deleteClip(selection.clip.id)">
          <MxIcon name="lucide:trash-2" :size="16" />
          删除
        </button>
      </div>
    </div>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 0.5px solid var(--mx-separator);
  background: var(--mx-bg-surface);
}

.head {
  padding: var(--mx-space-3) var(--mx-space-4);
  border-bottom: 0.5px solid var(--mx-separator);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-2);
  color: var(--mx-text-tertiary);
  font: var(--mx-font-caption);
  padding: var(--mx-space-4);
  text-align: center;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* space-3：底部三按钮（min-content ≈74 ×3 + gap 8 = 230）须收进内容区，
   * space-4 时可用 228 差 2px 挤成两行（2026-10-02 实测） */
  padding: var(--mx-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.info {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.groupTitle {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  border-top: 0.5px solid var(--mx-separator);
  padding-top: var(--mx-space-3);
}

.row {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.rowCol {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  flex: 1;
}

.rowPair {
  display: flex;
  gap: var(--mx-space-3);
}

.label {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  font-variant-numeric: tabular-nums;
}

.range {
  width: 100%;
  accent-color: var(--mx-accent);
}

.select {
  width: 100%;
}

.textarea {
  width: 100%;
  resize: vertical;
}

.color {
  width: 100%;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: var(--mx-module);
  cursor: pointer;
}

.color:hover {
  border-color: var(--mx-accent);
}

.color:active {
  border-color: var(--mx-accent);
}

.color:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 2px;
}

.color:disabled {
  cursor: default;
  opacity: 0.5;
}

.emojiPreview {
  font-size: 48px;
  text-align: center;
  padding: var(--mx-space-3) 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  /* space-1：三按钮（min-content ≈74px ×3）加间距须收进 260 面板内容区（236px），
   * space-2 会差 2px 挤成两行 */
  gap: var(--mx-space-1);
  border-top: 0.5px solid var(--mx-separator);
  padding-top: var(--mx-space-3);
}

.actions :global(.mx-btn) {
  /* nowrap：面板被压窄时按钮文字禁止竖排换行（用户截图实踩）；配合容器
   * flex-wrap 放不下时按钮整体换行，文字始终横排完整。
   * 注意 :global 必须显式——modules 里裸写 .mx-btn 会被哈希、整条静默失效 */
  white-space: nowrap;
  flex: 1;
}

.danger {
  color: var(--mx-state-error);
}

/* 导出中锁定整块输入（store 层另有 exporting 早退守卫双保险）：禁用语义，
 * 不必逐控件 disabled；短暂锁滚动可接受 */
.locked {
  pointer-events: none;
  opacity: 0.55;
}
</style>
