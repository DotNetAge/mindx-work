<script setup lang="ts">
/**
 * SettingsPane：设置独立面板。面板由壳自动生成，注册者只提供页与行（契约第 4 节）。
 * 开合与页切换为壳机制状态（壳唯一写）。
 * 骨架全部对齐 DSH SettingsRoot.module.css 真实值（逐项注明行号）：
 * panel 800 宽 / height min(800, vh-48) / radius 32 / bg layer-2（L85-94），
 * nav 188px / padding 22 12 0 / gap 18（L107-116），navTitle 16px（L118-120），
 * navCell 高 40 / padding 9 16 9 12 / radius 12（L136-148），
 * header 高 54（L184-193，DSH 无关闭钮——关闭走 Esc 与遮罩点击），options padding 0 24 24（L224-227）。
 */
import { onMounted, onUnmounted } from 'vue'
import { useShell, useShellData } from '../reactivity'
import MxIcon from '../MxIcon.vue'

const shell = useShell()
const data = useShellData(() => ({
  pages: shell.Settings.pages,
  activePageId: shell.Settings.activePageId,
  rowsOfActivePage: shell.Settings.rows.filter(
    (row) => (row.page ?? 'general') === shell.Settings.activePageId,
  ),
}))

/** 关闭交互对齐 DSH：Esc 键 + 遮罩点击（面板头无关闭钮） */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') shell.Settings.close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div :class="$style.mask" @click.self="shell.Settings.close()">
    <div :class="$style.panel">
      <nav :class="$style.pages">
        <!-- 壳固有标题（同"通用"页先例：面板机制文案） -->
        <div :class="$style.navTitle">设置</div>
        <div :class="$style.navList">
          <button
            v-for="page in data.pages"
            :key="page.id"
            type="button"
            :class="$style.pageItem"
            :data-active="page.id === data.activePageId ? 'true' : 'false'"
            @click="shell.Settings.setActivePage(page.id)"
          >
            <MxIcon v-if="page.icon" :name="page.icon" :size="16" />
            <span>{{ page.title }}</span>
          </button>
        </div>
      </nav>
      <div :class="$style.content">
        <!-- 面板头（DSH header 高 54，无关闭钮；操作组属插件扩展席位，demo 未注册故留白） -->
        <header :class="$style.header" />
        <div :class="$style.rows">
          <component :is="row.component" v-for="row in data.rowsOfActivePage" :key="row.id" />
          <!-- 空态零文案：仅留白 -->
          <div v-if="data.rowsOfActivePage.length === 0" :class="$style.empty" />
        </div>
      </div>
    </div>
  </div>
</template>

<style module>
/* 遮罩：bg-mask-1（L59-73，亮 #000@24% / 暗 50%）+ mask-blur 2px 背景模糊 */
.mask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--mx-mask);
  backdrop-filter: var(--mx-mask-blur);
  z-index: 60;
  animation: fade-in var(--mx-duration-motion) var(--mx-ease-standard);
}

/* 面板（panel L85-94）：800 宽 / min(800, vh-48) 高 / radius 32 / layer-2 底 */
.panel {
  display: flex;
  width: 800px;
  height: min(800px, calc(100vh - 48px));
  max-width: calc(100vw - 48px);
  background: var(--mx-bg-elevated);
  border-radius: 32px;
  box-shadow: var(--mx-shadow-panel); /* elevation-panel（L30-31） */
  overflow: hidden;
  animation: panel-in var(--mx-duration-motion) var(--mx-ease-standard);
}

/* 导航列（nav L107-116）：188 宽 / padding 22 12 0 / gap 18 / 无分隔线（靠层色差） */
.pages {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 188px;
  padding: 22px 12px 0;
  flex-shrink: 0;
  overflow-y: auto;
}

/* navTitle（L118-120）：16px 标题 */
.navTitle {
  padding: 0 12px;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: var(--mx-text);
}

.navList {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

/* navCell（L136-148）：高 40 / padding 9 16 9 12 / gap 8 / radius 12 / 14px */
.pageItem {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  height: 40px;
  padding: 9px 16px 9px 12px;
  box-sizing: border-box;
  font: var(--mx-font-body);
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

/* navCell:hover / .active（L155-160）：specific-sidebar-nav-item-hover / active */
.pageItem:hover:not([data-active='true']) {
  background: var(--mx-nav-hover);
}

.pageItem:active:not([data-active='true']) {
  background: var(--mx-nav-hover);
}

.pageItem:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.pageItem:disabled {
  opacity: 0.4;
  cursor: default;
}

.pageItem[data-active='true'] {
  color: var(--mx-text);
  background: var(--mx-nav-active);
}

/* 内容列：header（L184-193）高 54 + 内容区（options L224-227）padding 0 24 24 */
.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  height: 54px;
  padding: 20px 14px 8px 10px;
  box-sizing: border-box;
}

/* 内容行区（options L224-227）：padding 0 24 24 */
.rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 24px;
}

/* 行分隔：0.5px border-l2（AppearanceRow/PreferenceRow 行底分隔线同值） */
.rows > * + * {
  border-top: 0.5px solid var(--mx-separator);
}

.empty {
  min-height: var(--mx-space-7);
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(-12px) scale(0.82);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mask,
  .panel {
    animation: none;
  }
}
</style>
