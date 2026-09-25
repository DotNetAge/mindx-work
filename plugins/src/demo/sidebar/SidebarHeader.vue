<script setup lang="ts">
/** Sidebar Header 固定区：logoRow + 折叠按钮。
 * 几何对齐 DSH SidebarRoot.module.css：
 * 展开态 logoRow 高 60 / padding 8 0 8 4 / mb 4（L211-222），brandName 18px/600/0.04em（L281-291），
 * toggle 28x28 圆形、secondary 墨色（L316-331）；
 * 折叠态 36x36 / radius 12 / primary 墨色 / mb 12（L224-229,337-342,367-369），
 * 常态品牌标、悬停换 panel 图标（L347-357）。 */
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'

const props = defineProps<{ compact?: boolean }>()
const shell = useShell()
</script>

<template>
  <!-- 折叠态：36x36 盒，常态品牌标、悬停显示展开图标（railMark/panelIcon 切换） -->
  <button
    v-if="props.compact"
    type="button"
    :class="$style.brandOnly"
    title="展开侧栏"
    @click="shell.toggleSidebar()"
  >
    <span role="img" aria-label="MindX" :class="$style.railMark" />
    <MxIcon name="lucide:panel-left" :size="20" :class="$style.panelIcon" />
  </button>
  <div v-else :class="$style.header">
    <div :class="$style.brand">
      <span role="img" aria-label="MindX" :class="$style.logo" />
      <span :class="$style.brandName">MindX Work</span>
    </div>
    <button
      type="button"
      :class="$style.toggle"
      aria-label="切换侧栏"
      @click="shell.toggleSidebar()"
    >
      <MxIcon name="lucide:panel-left" :size="16" />
    </button>
  </div>
</template>

<style module>
/* logoRow（L211-222）：高 60、padding 8 0 8 4、mb 4；brand 占满，toggle 靠右 */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  height: 60px;
  padding: var(--mx-space-2) 0 var(--mx-space-2) 4px;
  margin-bottom: var(--mx-space-1);
  box-sizing: border-box;
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-width: 0;
  color: var(--mx-text);
}

/* 官方 logo 单色 glyph（mono 版，svg 原始比例 648:577）：mask 取形、
 * 填充色跟随 --mx-text——浅色主题呈黑（主 Logo 定稿，彩色版归 mindx-desktop）、
 * 深色主题自动翻白，双主题一份资源，组件不感知主题名 */
.logo {
  height: 24px;
  width: calc(24px * 648 / 577);
  display: block;
  background-color: var(--mx-text);
  mask: url('../assets/logo.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/logo.svg') no-repeat center / contain;
}

.railMark {
  height: 20px;
  width: calc(20px * 648 / 577);
  display: block;
  background-color: var(--mx-text);
  mask: url('../assets/logo.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/logo.svg') no-repeat center / contain;
}

/* brandName（L281-291）：18px / 600 / 0.04em / lh 24 */
.brandName {
  font: var(--mx-font-brand);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* iconButton（L316-331）：28x28 圆形、transparent、secondary 墨色、hover 交互灰 */
.toggle {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--mx-text-secondary);
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.toggle:hover {
  background: var(--mx-hover);
}

.toggle:active {
  background: var(--mx-active);
}

.toggle:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.toggle:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 折叠 rail 按钮（collapsed iconButton L337-342）：36x36 / radius 12 / primary 墨色 */
.brandOnly {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-bottom: var(--mx-space-3);
  padding: 0;
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

/* 常态品牌标、悬停换展开图标（L347-357 railMark/panelIcon 切换） */
.panelIcon {
  display: none;
}

.brandOnly:hover .panelIcon {
  display: inline-flex;
}

.brandOnly:hover .railMark {
  display: none;
}

.brandOnly:hover {
  background: var(--mx-hover);
}

.brandOnly:active {
  background: var(--mx-active);
}

.brandOnly:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.brandOnly:disabled {
  opacity: 0.4;
  cursor: default;
}

/* macOS 壳：header 行整体是窗口拖动带（红绿灯嵌在此排），
 * 行内可点控件（品牌区 / 折叠钮）显式 no-drag 才能接收点击；
 * web 下 -webkit-app-region 无副作用（对齐 DSH web/base.css 的 app-regions 机制） */
.header {
  -webkit-app-region: drag;
}

.brand,
.toggle,
.brandOnly {
  -webkit-app-region: no-drag;
}
</style>
