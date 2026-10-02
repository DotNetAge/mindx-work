<script setup lang="ts">
/**
 * Sidebar Footer 更新图标（纯图标，仅在有更新时出现——更新机制定稿 2026-10-02）：
 * downloading = 进度态（环形进度环绕下载箭头），点击打开设置页查看状态；
 * ready = 待安装态（accent 圆点点亮），点击确认后 quitAndInstall 立即重启安装；
 * ready 首次出现轻提示「新版已就绪」。状态经宿主桥 updater 段拉取 + 事件推送驱动，
 * idle / checking / 无桥（纯 Web）不渲染——"仅在有更新时出现"。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { MxIcon, useShell, ElMessage, ElMessageBox } from '@mindx-work/ui-shell-vue'
import type { UpdaterSnapshot } from '@mindx-work/ui-shell'

const shell = useShell()
const snap = ref<UpdaterSnapshot | null>(null)
let unsubscribe: (() => void) | null = null
let readyNotified = false

/** 进度环几何：r=10 周长 2πr，dashoffset 随 percent 收缩 */
const RING_R = 10
const RING_C = 2 * Math.PI * RING_R

onMounted(async () => {
  const bridge = window.mxDesktop?.updater
  if (!bridge) return
  snap.value = await bridge.getState()
  unsubscribe = bridge.onEvent((next) => {
    snap.value = next
    if (next.status === 'ready' && !readyNotified) {
      readyNotified = true
      ElMessage.info('新版已就绪，点击侧栏下载图标安装')
    }
  })
})

onUnmounted(() => unsubscribe?.())

function onClick(): void {
  const state = snap.value
  if (!state) return
  if (state.status === 'ready') {
    void ElMessageBox.confirm(
      `将退出并安装新版 ${state.availableVersion ?? ''}，未保存的工作请先确认。`,
      '安装更新',
      { confirmButtonText: '立即重启安装', cancelButtonText: '稍后', type: 'info' },
    )
      .then(() => window.mxDesktop?.updater.install())
      .catch(() => {})
    return
  }
  // downloading / checking：设置页"通用"页的版本行承载状态文案
  shell.Settings.open()
}
</script>

<template>
  <!-- v-if：仅 downloading / ready 渲染（idle / checking 不出现，"仅在有更新时出现"） -->
  <button
    v-if="snap && (snap.status === 'downloading' || snap.status === 'ready')"
    type="button"
    :class="$style.badge"
    :title="snap.status === 'ready'
      ? `新版 v${snap.availableVersion ?? ''} 已就绪，点击安装`
      : `正在下载 v${snap.availableVersion ?? ''}（${Math.round(snap.percent ?? 0)}%）`"
    @click="onClick"
  >
    <svg :class="$style.ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle :class="$style.ringTrack" cx="12" cy="12" :r="RING_R" />
      <circle
        :class="$style.ringBar"
        cx="12"
        cy="12"
        :r="RING_R"
        :stroke-dasharray="RING_C"
        :stroke-dashoffset="snap.status === 'ready' ? 0 : RING_C * (1 - (snap.percent ?? 0) / 100)"
      />
    </svg>
    <span :class="$style.icon"><MxIcon name="lucide:download" :size="16" /></span>
  </button>
</template>

<style module>
/* 纯图标徽章：36x36 盒居中（对齐 SidebarPane .collapsed .footerToggle 节奏），
   42px 行高带上下 margin 4 与相邻 footer 行节奏一致 */
.badge {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 4px auto;
  padding: 0;
  box-sizing: border-box;
  border: none;
  border-radius: var(--mx-radius-card);
  background: transparent;
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.badge:hover {
  background: var(--mx-hover);
}

.badge:active {
  background: var(--mx-active);
}

.badge:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

/* 进度环：绝对定位包住图标；轨道低对比、进度条 accent；
   SVG 旋转 -90° 让进度从顶部起时针方向 */
.ring {
  position: absolute;
  inset: 1px;
  width: 34px;
  height: 34px;
  transform: rotate(-90deg);
}

.ringTrack {
  fill: none;
  stroke: var(--mx-separator-soft);
  stroke-width: 2;
}

.ringBar {
  fill: none;
  stroke: var(--mx-accent);
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--mx-duration-fast) var(--mx-ease-standard);
}

/* 图标容器置于环心之上（进度环为绝对定位装饰，图标是内容主体） */
.icon {
  position: relative;
  display: inline-flex;
}
</style>
