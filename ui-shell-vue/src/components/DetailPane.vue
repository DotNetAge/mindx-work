<script setup lang="ts">
/**
 * DetailPane：DetailToolbar + 轨道（契约第 4 节）。
 * DetailToolbar 区只有左右两侧：左侧为激活条目 Title（隐式切换，无 Tab 组件——
 * 条目激活由编程式 show/setActiveTab 决定），右侧为尾段按钮组席位 + 壳固有关闭钮。
 * 轨道解决 Content 让位；shown / activeTab 为壳状态。
 * 宽度可拖拽调节（几何属壳职责，宽度为适配器本地状态，双击手柄重置）；
 * 打开时轨道自右缘滑入。
 */
import { nextTick, ref, watch } from 'vue'
import { useShell, useShellData } from '../reactivity'
import MxIcon from '../MxIcon.vue'

/** 宽度边界与缺省值（缺省 320；上限 = 中段一半的动态约束，见 measureMax） */
const WIDTH_MIN = 240
const WIDTH_DEFAULT = 320

const shell = useShell()
const data = useShellData(() => {
  const activeId = shell.Detail.activeTabId
  return {
    shown: shell.Detail.shown,
    // DetailToolbar 左侧 Title：激活条目的 title（零文案壳：无标题则留白）
    title: shell.Detail.entries.find((entry) => entry.id === activeId)?.title ?? '',
    // DetailToolbar 尾段按钮组：按 owner 归属过滤——每条目一套，仅激活条目的按钮组呈现
    // （壳固有默认工具组在 Content 顶部 Toolbar 尾段，见 ToolbarPane）
    buttons: shell.Detail.toolbarEntries.filter((btn) => btn.owner === activeId),
    // 壳固有默认工具组呈现条件：多层才有关闭钮；激活层 defaultTools=false 时整组隐藏
    detailMulti: shell.Detail.entries.length > 1,
    defaultTools:
      shell.Detail.entries.find((entry) => entry.id === activeId)?.defaultTools !== false,
  }
})
// Content 中列收起（壳全屏让位）：解除平分约束，Detail 独占 Sidebar 右侧空间
const expanded = useShellData(() => shell.contentCollapsed)
const activeTab = useShellData(
  () => shell.Detail.entries.find((entry) => entry.id === shell.Detail.activeTabId) ?? null,
)

const width = ref(WIDTH_DEFAULT)
const dragging = ref(false)
/** 根元素引用：拖拽时实测「中段一半」约束（frame 宽 - 侧栏宽）/ 2 */
const rootRef = ref<HTMLElement | null>(null)

/** 声明式满宽（DetailEntry.openMax）：轨道拉出或切层到 openMax 条目时，
 * 宽度默认取当前上限（openMaxActive 由版本订阅驱动，与文件内其余壳状态读取同范式） */
const openMaxActive = useShellData(
  () =>
    shell.Detail.shown &&
    !!shell.Detail.entries.find((entry) => entry.id === shell.Detail.activeTabId)?.openMax,
)
watch(openMaxActive, async (active) => {
  if (!active) return
  // 等 v-if 挂载完成再实测上限（rootRef 挂载后才有值）
  await nextTick()
  const max = measureMax()
  if (Number.isFinite(max)) width.value = max
})

/** 平分约束：Detail 最大 = Sidebar 右侧空间的一半（与 Content 一人一半）。
 * 实测 frame 宽与 --mx-frame-sidebar（AppFrame 绑定，折叠取 rail 80）；
 * CSS max-width 同式兜底窗口 resize，这里保证拖拽 state 不超过显示宽 */
function measureMax(): number {
  const frame = rootRef.value?.parentElement
  if (!frame) return Number.POSITIVE_INFINITY
  // 全屏独占（Content 中列收起）时不做平分约束，可拖至全宽
  if (shell.contentCollapsed) return frame.clientWidth
  const sidebar = parseFloat(getComputedStyle(frame).getPropertyValue('--mx-frame-sidebar'))
  return (frame.clientWidth - (Number.isFinite(sidebar) ? sidebar : 0)) / 2
}

function onResizeStart(event: PointerEvent) {
  dragging.value = true
  const startX = event.clientX
  const startWidth = width.value
  const maxWidth = measureMax()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const onMove = (e: PointerEvent) => {
    // 轨道在右缘：向左拖加宽（与 Sidebar 手柄方向相反）
    width.value = Math.min(maxWidth, Math.max(WIDTH_MIN, startWidth - (e.clientX - startX)))
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
    ref="rootRef"
    :class="[$style.detail, { [$style.dragging]: dragging, [$style.expanded]: expanded }]"
    :style="{ '--detail-width': `${width}px` }"
    v-if="data.shown"
  >
    <!-- DetailToolbar 区：左 Title + 右尾段按钮组（壳固有默认工具组在 Content 顶部 Toolbar） -->
    <div :class="$style.toolbar">
      <div :class="$style.title">{{ data.title }}</div>
      <div :class="$style.group">
        <component :is="btn.component" v-for="btn in data.buttons" :key="btn.id" />
        <!-- 壳固有默认工具组：全屏/隐藏/关闭层退栈（X 仅多层；defaultTools=false 整组隐藏） -->
        <template v-if="data.defaultTools">
          <button
            type="button"
            class="mx-icon-btn"
            :aria-label="expanded ? '恢复内容区' : '内容区全屏'"
            @click="shell.toggleContent()"
          >
            <MxIcon :name="expanded ? 'lucide:minimize-2' : 'lucide:maximize-2'" :size="16" />
          </button>
          <button type="button" class="mx-icon-btn" aria-label="隐藏详情" @click="shell.Detail.hide()">
            <MxIcon name="lucide:panel-right" :size="16" />
          </button>
          <button
            v-if="data.detailMulti"
            type="button"
            class="mx-icon-btn"
            aria-label="关闭当前层"
            @click="shell.Detail.popActiveTab()"
          >
            <MxIcon name="lucide:x" :size="16" />
          </button>
        </template>
      </div>
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
  /* 平分约束兜底：Detail 最大 = Sidebar 右侧空间的一半（与 Content 一人一半）；
   * --mx-frame-sidebar 由 AppFrame 绑定（折叠取 rail 80），拖拽 state 同式 clamp */
  max-width: calc((100% - var(--mx-frame-sidebar, 0px)) / 2);
  /* 全屏收放时随中列过渡（.expanded 切换 max-width 百分比） */
  transition: max-width var(--mx-duration-motion) var(--mx-ease-standard);
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

/* 全屏独占：Content 中列收起后解除平分约束（max-width 百分比可插值，随中列收放过渡） */
.expanded {
  /* 全屏独占：脱离固定宽度，flex 填满 Sidebar 右侧全部空间（中列已收 0） */
  width: auto;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
}

/* 全屏态已无可调空间：隐藏拖拽手柄 */
.expanded .resizer {
  display: none;
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
  /* 高于主区内容（z-index 6）：盖过滚动内容与顶部工具栏，拖拽抓取不被遮挡 */
  z-index: 6;
}

.resizer:hover {
  background: color-mix(in srgb, var(--mx-accent) 35%, transparent);
}

/* DetailToolbar 区：左 Title + 右尾段按钮组。
   与 Content 顶部 Toolbar 同高（48px）：轨道全高布局下两者同一水平线，
   border-bottom 连成一条贯穿右区的分隔线 */
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  height: 48px;
  box-sizing: border-box;
  padding: 0 var(--mx-space-2);
  border-bottom: 1px solid var(--mx-separator);
  flex-shrink: 0;
}

/* 左 Title：零文案壳的呈现位（激活条目 title，无标题则留白），左对齐 */
.title {
  flex: 1;
  min-width: 0;
  padding: 0 var(--mx-space-2);
  font: var(--mx-font-heading);
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右尾段按钮组席位 + 壳固有关闭钮 */
.group {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-shrink: 0;
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
