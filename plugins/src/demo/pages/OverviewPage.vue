<script setup lang="ts">
/**
 * 总览页：壳编排能力演示入口。
 * 通过闭包持有的 shell 调用 Detail / Overlay 编排 API（契约第 8 节）。
 */
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import DemoModal from '../overlays/DemoModal.vue'
import DemoBanner from '../overlays/DemoBanner.vue'
import DemoFloater from '../overlays/DemoFloater.vue'
import { DEMO_MODAL_ID } from '../ids'

const shell = useShell()

const openDetail = () => shell.Detail.show('session-detail')

const openModal = () => {
  // modal 互斥：同 id 先移除再添加
  if (shell.Overlay.has(DEMO_MODAL_ID)) {
    shell.Overlay.remove(DEMO_MODAL_ID)
  }
  shell.Overlay.add({ id: DEMO_MODAL_ID, kind: 'modal', component: DemoModal })
}

let bannerSeq = 0
const pushBanner = () => {
  bannerSeq += 1
  shell.Overlay.add({
    id: `demo-banner-${bannerSeq}`,
    kind: 'banner',
    component: DemoBanner,
  })
}

// 浮窗可多开：每个条目独立成窗（拖动、置顶互不影响）
let floaterSeq = 0
const openFloater = () => {
  floaterSeq += 1
  shell.Floater.add({
    id: `demo-floater-${floaterSeq}`,
    title: `浮窗 ${floaterSeq}`,
    component: DemoFloater,
  })
}

const zones = [
  { icon: 'lucide:panel-top', label: 'Toolbar', text: '窗口工具栏两席位（leading / trailing）' },
  { icon: 'lucide:panel-left', label: 'Sidebar', text: '分节导航，行是数据模型由壳渲染' },
  { icon: 'lucide:square', label: 'Content', text: '单活动视图，activeId 壳唯一写' },
  { icon: 'lucide:panel-right', label: 'Detail', text: 'tabs + 轨道，show / hide 编程开合' },
  { icon: 'lucide:bell', label: 'Overlay', text: '全局浮层：modal 互斥，banner 可堆叠' },
  { icon: 'lucide:panel-bottom', label: 'Sheet', text: '全屏抽层：自底向上覆盖界面，互斥单开' },
  { icon: 'lucide:app-window', label: 'Floater', text: '可拖动浮窗：交通灯红灯关闭，可多开并存' },
  { icon: 'lucide:settings', label: 'Settings', text: '设置面板由壳自动生成，注册者只给页与行' },
]
</script>

<template>
  <div :class="$style.page">
    <h1 :class="$style.title">总览</h1>
    <p :class="$style.caption">八视图区由预置插件注册组装；本页演示壳的编排能力。</p>

    <div class="mx-card" :class="$style.card">
      <h2 :class="$style.heading">编排演示</h2>
      <div :class="$style.actions">
        <button type="button" class="mx-btn" @click="openDetail">
          <MxIcon name="lucide:panel-right" :size="16" />
          打开详情轨道
        </button>
        <button type="button" class="mx-btn" @click="openModal">
          <MxIcon name="lucide:square" :size="16" />
          弹出对话框
        </button>
        <button type="button" class="mx-btn" @click="pushBanner">
          <MxIcon name="lucide:bell" :size="16" />
          顶部通知
        </button>
        <button type="button" class="mx-btn" @click="openFloater">
          <MxIcon name="lucide:app-window" :size="16" />
          打开浮窗
        </button>
      </div>
      <p :class="$style.hint">连点"顶部通知"可验证 banner 堆叠；对话框同时至多一个；浮窗可拖动可多开。</p>
    </div>

    <div class="mx-card" :class="$style.card">
      <h2 :class="$style.heading">八视图区</h2>
      <ul :class="$style.zones">
        <li v-for="zone in zones" :key="zone.label" :class="$style.zone">
          <MxIcon :name="zone.icon" :size="16" />
          <span :class="$style.zoneLabel">{{ zone.label }}</span>
          <span :class="$style.zoneText">{{ zone.text }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style module>
.page {
  padding: var(--mx-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
}

.title {
  font: var(--mx-font-title);
  color: var(--mx-text);
  margin: 0;
}

.caption {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  margin: 0;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.heading {
  font: var(--mx-font-heading);
  color: var(--mx-text);
  margin: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mx-space-2);
}

.actions .mx-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}

.zones {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.zone {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) 0;
  color: var(--mx-text-secondary);
}

.zone + .zone {
  border-top: 1px solid var(--mx-separator);
}

.zoneLabel {
  font: var(--mx-font-body);
  color: var(--mx-text);
  width: 72px;
  flex-shrink: 0;
}

.zoneText {
  font: var(--mx-font-caption);
}
</style>
