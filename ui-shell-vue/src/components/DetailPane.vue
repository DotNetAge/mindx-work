<script setup lang="ts">
/**
 * DetailPane：tabs + 轨道（契约第 4 节）。
 * tab 归属解决多插件共存，轨道解决 Content 让位；shown / activeTab 为壳状态。
 * 宽度可拖拽调节（几何属壳职责，宽度为适配器本地状态，双击手柄重置）；
 * 打开时轨道自右缘滑入。
 */
import { ref } from 'vue'
import { useShell, useShellData } from '../reactivity'
import MxIcon from '../MxIcon.vue'

/** 宽度边界与缺省值（缺省 320，可放宽容纳宽内容） */
const WIDTH_MIN = 240
const WIDTH_MAX = 520
const WIDTH_DEFAULT = 320

const shell = useShell()
const data = useShellData(() => ({
  entries: shell.Detail.entries,
  activeTabId: shell.Detail.activeTabId,
  shown: shell.Detail.shown,
}))
const activeTab = useShellData(
  () => shell.Detail.entries.find((entry) => entry.id === shell.Detail.activeTabId) ?? null,
)

const width = ref(WIDTH_DEFAULT)
const dragging = ref(false)

function onResizeStart(event: PointerEvent) {
  dragging.value = true
  const startX = event.clientX
  const startWidth = width.value
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const onMove = (e: PointerEvent) => {
    // 轨道在右缘：向左拖加宽（与 Sidebar 手柄方向相反）
    width.value = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startWidth - (e.clientX - startX)))
  }
  const onUp = () => {
    dragging.value = false
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  // pointercancel（手势被系统接管/打断）同样终止拖拽，避免 dragging 卡死与监听泄漏
  target.addEventListener('pointercancel', onUp)
}
</script>

<template>
  <!-- 轨道收起（shown=false）时整体让位，不渲染骨架 -->
  <aside
    :class="[$style.detail, { [$style.dragging]: dragging }]"
    :style="{ '--detail-width': `${width}px` }"
    v-if="data.shown"
  >
    <div :class="$style.tabs">
      <button
        v-for="tab in data.entries"
        :key="tab.id"
        type="button"
        :class="$style.tab"
        :data-active="tab.id === data.activeTabId ? 'true' : 'false'"
        @click="shell.Detail.setActiveTab(tab.id)"
      >
        <MxIcon v-if="tab.icon" :name="tab.icon" :size="16" />
        <span>{{ tab.title }}</span>
      </button>
      <div :class="$style.spacer" />
      <!-- 壳机制固有的编排控件：图标非文案，不违反零文案壳 -->
      <button type="button" class="mx-icon-btn" aria-label="关闭详情" @click="shell.Detail.hide()">
        <MxIcon name="lucide:x" :size="16" />
      </button>
    </div>
    <div :class="$style.body">
      <component :is="activeTab.component" v-if="activeTab" :active="true" />
    </div>
    <!-- 左缘拖拽手柄：悬停时显示分隔高亮，双击重置 -->
    <div
      :class="$style.resizer"
      title="拖拽调节宽度，双击重置"
      @pointerdown="onResizeStart"
      @dblclick="width = WIDTH_DEFAULT"
    />
  </aside>
</template>

<style module>
/* 根：宽度由 --detail-width 承载（拖拽实时更新）；border-left 在左缘（手柄侧） */
.detail {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--detail-width);
  background: var(--mx-bg-surface);
  border-left: 1px solid var(--mx-separator);
  flex-shrink: 0;
  min-height: 0;
  /* 打开时自右缘滑入（shown 由 v-if 挂载触发） */
  animation: detail-in var(--mx-duration-motion) var(--mx-ease-standard);
}

/* 拖拽中禁用一切过渡，避免宽度更新与指针脱节 */
.dragging {
  transition: none;
}

@keyframes detail-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: none;
  }
}

/* 左缘拖拽手柄：悬停时显示分隔高亮，双击重置 */
.resizer {
  position: absolute;
  top: 0;
  left: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  /* 高于主区 dragBand（z-index 5）：否则顶部 48px 的手柄条被拖动带盖住无法抓取 */
  z-index: 6;
}

.resizer:hover {
  background: color-mix(in srgb, var(--mx-accent) 35%, transparent);
}

.tabs {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  padding: var(--mx-space-2);
  border-bottom: 1px solid var(--mx-separator);
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.tab:hover:not([data-active='true']) {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.tab:active:not([data-active='true']) {
  background: var(--mx-active);
}

.tab:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--mx-accent) 60%, transparent);
  outline-offset: -2px;
}

.tab:disabled {
  opacity: 0.4;
  cursor: default;
}

.tab[data-active='true'] {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.spacer {
  flex: 1;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--mx-space-4);
}

/* 动效只用于状态过渡；偏好减弱动效时关闭滑入动画 */
@media (prefers-reduced-motion: reduce) {
  .detail {
    animation: none;
  }
}
</style>
