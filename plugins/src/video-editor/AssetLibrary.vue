<script setup lang="ts">
/**
 * 素材库（左栏）：导入按钮（打开文件浏览器浮层）、素材网格（封面 + 名称 +
 * 时长），点击素材即添加到时间线对应轨；下方文字 / 贴纸快捷添加。
 */
import { useShell } from '@mindx-work/ui-shell-vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useVideoEditorStore } from './store'
import ImportBrowser from './ImportBrowser.vue'
import { formatTime } from './types'

const store = useVideoEditorStore()
const shell = useShell()

/** 浮层条目 id（重复打开前先移除，防双击叠层） */
const BROWSER_ID = 'video-editor-import-browser'

function openBrowser(): void {
  if (shell.Overlay.has(BROWSER_ID)) shell.Overlay.remove(BROWSER_ID)
  shell.Overlay.add({ id: BROWSER_ID, kind: 'modal', component: ImportBrowser })
}

/** 常用贴纸集（点选即加） */
const STICKERS = ['😂', '❤️', '🔥', '👍', '🎉', '⭐', '💡', '🎵', '👀', '💯', '🎬', '🙌']
</script>

<template>
  <div :class="$style.wrap">
    <div :class="$style.head">
      <span :class="$style.title">素材</span>
      <button type="button" class="mx-btn" :disabled="store.exporting" @click="openBrowser">
        <MxIcon name="lucide:folder-open" :size="16" />
        导入
      </button>
    </div>

    <div :class="$style.grid">
      <div v-if="store.project.assets.length === 0" :class="$style.hint">
        还没有素材，点击上方「导入」从工作目录挑选
      </div>
      <button
        v-for="asset in store.project.assets"
        :key="asset.id"
        type="button"
        :class="$style.asset"
        :title="asset.name"
        :disabled="store.exporting"
        @click="store.addMediaClip(asset.id)"
      >
        <span :class="$style.thumbBox">
          <img v-if="asset.thumb" :src="asset.thumb" :class="$style.thumb" alt="" />
          <MxIcon v-else :name="asset.kind === 'audio' ? 'lucide:audio-lines' : 'lucide:image'" :size="20" />
          <span v-if="asset.kind !== 'image' && asset.duration > 0" :class="$style.dur">
            {{ formatTime(asset.duration) }}
          </span>
        </span>
        <span :class="$style.name">{{ asset.name }}</span>
      </button>
    </div>

    <div :class="$style.quick">
      <button type="button" class="mx-btn" :class="$style.quickBtn" :disabled="store.exporting" @click="store.addTextClip()">
        <MxIcon name="lucide:type" :size="16" />
        文字
      </button>
      <div :class="$style.stickers">
        <button
          v-for="emoji in STICKERS"
          :key="emoji"
          type="button"
          :class="$style.sticker"
          :disabled="store.exporting"
          @click="store.addStickerClip(emoji)"
        >
          {{ emoji }}
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
  border-right: 0.5px solid var(--mx-separator);
  background: var(--mx-bg-surface);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mx-space-3) var(--mx-space-4);
  border-bottom: 0.5px solid var(--mx-separator);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--mx-space-3);
  padding: var(--mx-space-4);
  align-content: start;
}

.hint {
  grid-column: 1 / -1;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-4) 0;
  text-align: center;
}

.asset {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--mx-radius-card);
  text-align: left;
}

.asset:hover .thumbBox {
  border-color: var(--mx-border-strong);
}

.asset:active .thumbBox {
  background: var(--mx-active);
}

.asset:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 2px;
}

.asset:disabled {
  cursor: default;
  opacity: 0.5;
}

.thumbBox {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  border-radius: var(--mx-radius-control);
  border: 1px solid var(--mx-separator);
  background: var(--mx-module);
  color: var(--mx-text-tertiary);
  overflow: hidden;
}

.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.dur {
  position: absolute;
  right: 4px;
  bottom: 4px;
  font: var(--mx-font-micro);
  color: var(--mx-static-white);
  background: var(--mx-tooltip-bg);
  border-radius: 4px;
  padding: 1px 4px;
  font-variant-numeric: tabular-nums;
}

.name {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick {
  border-top: 0.5px solid var(--mx-separator);
  padding: var(--mx-space-3) var(--mx-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.quickBtn {
  align-self: flex-start;
}

.stickers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mx-space-1);
}

.sticker {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: none;
  background: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
}

.sticker:hover {
  background: var(--mx-hover);
}

.sticker:active {
  background: var(--mx-active);
}

.sticker:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 2px;
}

.sticker:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
