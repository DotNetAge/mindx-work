<script setup lang="ts">
/**
 * 视频剪辑主面板（Detail 席位）：三栏 + 底部时间线的四区布局。
 * 左 = 素材库，中 = 预览播放器，右 = 属性检查器，下 = 多轨时间线。
 * canvas 渲染循环由预览播放器自持（每帧重画，视频元素动态帧依赖它）。
 */
import AssetLibrary from './AssetLibrary.vue'
import PreviewPlayer from './PreviewPlayer.vue'
import InspectorPanel from './InspectorPanel.vue'
import Timeline from './Timeline.vue'
</script>

<template>
  <div :class="$style.panel">
    <div :class="$style.top">
      <AssetLibrary :class="$style.library" />
      <PreviewPlayer :class="$style.preview" />
      <InspectorPanel :class="$style.inspector" />
    </div>
    <Timeline :class="$style.timeline" />
  </div>
</template>

<style module>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--mx-bg-window);
}

.top {
  display: flex;
  flex: 1;
  min-height: 0;
  border-bottom: 0.5px solid var(--mx-separator);
}

.library {
  width: 240px;
  flex: none;
}

.preview {
  flex: 1;
  min-width: 0;
}

.inspector {
  width: 260px;
  flex: none;
}

.timeline {
  height: 220px;
  flex: none;
}
</style>
