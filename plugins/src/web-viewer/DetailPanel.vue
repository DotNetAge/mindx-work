<script setup lang="ts">
/**
 * web-viewer 详情面板：多页式浏览器（Chrome 观感：页签条深底，选中页签为
 * 与工具行/内容区同底的连体圆角顶块；每页独立地址栏 + iframe 嵌入）。
 * 已知浏览器约束：目标站 X-Frame-Options / CSP frame-ancestors 拒绝时 iframe 空白。
 * 地址栏为草稿态编辑（切换页签同步当前 URL），回车导航。
 * favicon 直取站点 origin/favicon.ico（无第三方服务依赖），失败回退首字母圆标。
 */
import { computed, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useWebViewerStore } from './store'

const store = useWebViewerStore()

const activeTab = computed(
  () => store.tabs.find((t) => t.id === store.activeTabId) || null
)

// ── 地址栏（草稿态：切换页签同步当前 URL，编辑不即时导航）───────────────────
const urlDraft = ref('')
watch(
  () => activeTab.value?.url,
  (url) => {
    urlDraft.value = url || ''
  },
  { immediate: true }
)

/** 地址栏回车：导航当前页签（空 url 页签首次输入同样走 navigate） */
function submitUrl(): void {
  if (activeTab.value && urlDraft.value.trim()) {
    store.navigate(activeTab.value.id, urlDraft.value)
  }
}

/** 新开空白页签（空 url 待导航态，地址栏输入后回车） */
function openBlank(): void {
  store.newTab()
}

/** tab 标题：域名（空 url 待导航 / about: 显示占位名） */
function tabTitle(url: string): string {
  if (!url || url.startsWith('about:')) return url ? '空白页' : '新页签'
  return store.hostOf(url)
}

// ── favicon：直取站点 origin/favicon.ico，加载失败回退首字母圆标 ────────────
const brokenFavicons = ref<Set<string>>(new Set())

function faviconUrl(url: string): string {
  try {
    return new URL(url).origin + '/favicon.ico'
  } catch {
    return ''
  }
}

function markFaviconBroken(url: string): void {
  brokenFavicons.value = new Set([...brokenFavicons.value, url])
}

/** 首字母圆标字符：域名首字符（中文/字母通用） */
function faviconLetter(url: string): string {
  const host = store.hostOf(url)
  return (host.replace(/^www\./, '')[0] || '?').toUpperCase()
}
</script>

<template>
  <div :class="$style.panel">
    <!-- 页签条：Chrome 观感——条底深色，选中页签同工具行底色连体（上圆角顶块） -->
    <div :class="$style.tabstrip">
      <button
        v-for="tab in store.tabs"
        :key="tab.id"
        type="button"
        :class="[$style.tab, { [$style.tabActive]: tab.id === store.activeTabId }]"
        :aria-selected="tab.id === store.activeTabId"
        role="tab"
        :title="tab.url"
        @click="store.setActive(tab.id)"
      >
        <!-- favicon：站点图标，失败回退首字母圆标；无 url 页签显示占位 -->
        <img
          v-if="tab.url && !tab.url.startsWith('about:') && faviconUrl(tab.url) && !brokenFavicons.has(tab.url)"
          :src="faviconUrl(tab.url)"
          alt=""
          :class="$style.tabFavicon"
          referrerpolicy="no-referrer"
          @error="markFaviconBroken(tab.url)"
        />
        <span
          v-else-if="tab.url && !tab.url.startsWith('about:')"
          :class="$style.tabLetter"
        >{{ faviconLetter(tab.url) }}</span>
        <MxIcon v-else name="lucide:globe" :size="16" />
        <span :class="$style.tabTitle">{{ tabTitle(tab.url) }}</span>
        <span
          :class="$style.tabClose"
          role="button"
          aria-label="关闭页签"
          @click.stop="store.closeTab(tab.id)"
        >
          <MxIcon name="lucide:x" :size="16" />
        </span>
      </button>
      <button type="button" :class="$style.addTab" aria-label="新开页签" @click="openBlank">
        <MxIcon name="lucide:plus" :size="16" />
      </button>
    </div>

    <!-- 工具行：与选中页签同底连体（地址栏全胶囊） -->
    <div v-if="activeTab" :class="$style.toolrow">
      <div :class="$style.urlbar">
        <MxIcon name="lucide:lock" :size="16" />
        <input
          v-model="urlDraft"
          :class="$style.urlInput"
          type="text"
          spellcheck="false"
          placeholder="输入网址"
          @keydown.enter="submitUrl"
        />
      </div>
    </div>

    <!-- 内容区：与工具行同底连体 -->
    <div :class="$style.body">
      <!-- 空态 -->
      <div v-if="!activeTab" :class="$style.empty">
        <MxIcon name="lucide:globe" :size="20" />
        <p :class="$style.hint">点击对话中的链接，或按上方 + 新开网页</p>
      </div>
      <template v-else>
        <div v-if="!activeTab.url" :class="$style.empty">
          <MxIcon name="lucide:globe" :size="20" />
          <p :class="$style.hint">在上方地址栏输入网址后回车</p>
        </div>
        <iframe
          v-else-if="activeTab.url.startsWith('about:')"
          :class="$style.frame"
          title="空白页"
        ></iframe>
        <iframe
          v-else
          :key="activeTab.url"
          :src="activeTab.url"
          :class="$style.frame"
          :title="tabTitle(activeTab.url)"
          referrerpolicy="no-referrer"
        ></iframe>
      </template>
    </div>
  </div>
</template>

<style module>
/* 满铺 Detail body（抵消壳 padding，Chrome 结构需要页签条贴轨顶与左右缘） */
.panel {
  margin: calc(-1 * var(--mx-space-4));
  height: calc(100% + var(--mx-space-4) * 2);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--mx-bg-surface);
}

/* ── 页签条：深底（窗口底），选中页签下缘与工具行连体 ── */
.tabstrip {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: var(--mx-space-2) var(--mx-space-2) 0;
  background: var(--mx-bg-window);
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
}

.tabstrip::-webkit-scrollbar {
  display: none;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 180px;
  min-width: 96px;
  height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: 10px 10px 0 0;
  background: transparent;
  color: var(--mx-text-tertiary);
  font: var(--mx-font-caption);
  cursor: pointer;
}

.tab:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}

.tab:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: -2px;
}

/* 选中页签：同工具行/内容区底色，上圆角顶块与下方连体 */
.tabActive,
.tabActive:hover {
  background: var(--mx-bg-surface);
  color: var(--mx-text);
}

.tabFavicon {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* favicon 失败回退：首字母圆标 */
.tabLetter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--mx-hover);
  color: var(--mx-text-secondary);
  font-size: 9px;
  font-weight: 600;
  flex-shrink: 0;
}

.tabTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.tabClose {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--mx-radius-control);
  color: var(--mx-text-tertiary);
  opacity: 0.6;
  flex-shrink: 0;
}

.tabClose:hover {
  opacity: 1;
  color: var(--mx-text);
  background: var(--mx-active);
}

.addTab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 3px;
  padding: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.addTab:hover {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.addTab:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: 1px;
}

/* ── 工具行：与选中页签同底连体 ── */
.toolrow {
  display: flex;
  padding: var(--mx-space-2) var(--mx-space-3);
  background: var(--mx-bg-surface);
  flex-shrink: 0;
}

/* 地址栏：全胶囊填充式（Chrome 观感，去描边） */
.urlbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  height: 30px;
  padding: 0 var(--mx-space-3);
  border-radius: 999px;
  background: var(--mx-hover);
  color: var(--mx-text-tertiary);
  flex: 1;
  min-width: 0;
}

.urlbar:focus-within {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: -1px;
}

.urlInput {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-text);
}

.urlInput::placeholder {
  color: var(--mx-text-caption);
}

/* ── 内容区：与工具行同底连体，iframe 方角满铺 ── */
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--mx-bg-surface);
}

.frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: none;
  background: var(--mx-menu-bg);
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
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}
</style>
