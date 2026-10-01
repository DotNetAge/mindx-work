<script setup lang="ts">
/**
 * video-viewer 详情面板：原生 <video> 播放（controls 内建播放/进度/音量，
 * mx-file:// 协议走主进程 Range 分段流）。open 无取数步骤（流地址即开即播）；
 * 加载/解码失败（容器格式如 avi/flv 浏览器不解）转错误态不炸。
 */
import { computed, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useVideoViewerStore } from './store'

const store = useVideoViewerStore()

/** 文件名（标题展示） */
const fileName = computed(() => store.currentFile.split('/').pop() || store.currentFile)

// 解码错误态：切视频（srcUrl 变化）时复位，video error 事件置位
const videoError = ref(false)
watch(
  () => store.srcUrl,
  () => {
    videoError.value = false
  }
)
</script>

<template>
  <div :class="$style.panel">
    <!-- 头部：文件名 -->
    <div :class="$style.header">
      <span :class="$style.fileName" :title="store.currentFile">
        <MxIcon name="lucide:film" :size="16" />
        {{ fileName || '未打开视频' }}
      </span>
    </div>

    <!-- 解码失败态：容器/编码不受浏览器支持 -->
    <div v-if="videoError" :class="$style.empty">
      <MxIcon name="lucide:triangle-alert" :size="20" />
      <p :class="$style.hint">该视频编码不受支持或文件不可读（avi/flv 等容器浏览器无法解码）</p>
    </div>

    <!-- 播放器：流地址切换即换源（:key 强制重建 video 元素） -->
    <video
      v-else-if="store.srcUrl"
      :key="store.srcUrl"
      :src="store.srcUrl"
      :class="$style.player"
      controls
      autoplay
      @error="videoError = true"
    ></video>

    <!-- 空态 -->
    <div v-else :class="$style.empty">
      <MxIcon name="lucide:film" :size="20" />
      <p :class="$style.hint">从对话或文件树中打开一个视频</p>
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

/* 播放区：与内容底一致，video 元素等比满铺（object-fit 交内建 controls 语义） */
.player {
  flex: 1;
  min-height: 0;
  width: 100%;
  border-radius: var(--mx-radius-card);
  background: var(--mx-menu-bg);
  object-fit: contain;
}

.empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-2);
  color: var(--mx-text-caption);
  border-radius: var(--mx-radius-card);
  background: var(--mx-menu-bg);
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}
</style>
