<script setup lang="ts">
/**
 * 模型管理行："模型"设置页唯一自定义行，承载完整管理器（market 的 MarketManageRow 先例）。
 * 布局为上下结构（规格定稿，不照抄源组件左右双栏）：
 * 上节供应商 = 品牌卡片横排（可左右滚动），下节模型 = 当前供应商的模型列表。
 * 编排归组件（Overlay 开合、banner 推送）；数据与 RPC 归 store。
 */
import { onMounted } from 'vue'
import type { Component } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useModelsStore } from '../store'
import { pushNotice } from '../notice'
import { providerIcon } from '../providerIcons'
import { formatProviderTitle, modelPriceLine } from '../format'
import { MODAL_CONFIRM, MODAL_MODEL_FORM, MODAL_ONLINE_BROWSER, MODAL_PROVIDER_FORM } from '../ids'
import type { ModelConfig, ProviderInfo } from '../types'
import ProviderFormModal from '../overlays/ProviderFormModal.vue'
import ModelFormModal from '../overlays/ModelFormModal.vue'
import OnlineBrowserModal from '../overlays/OnlineBrowserModal.vue'
import ConfirmModal from '../overlays/ConfirmModal.vue'

const store = useModelsStore()
const shell = useShell()

onMounted(() => {
  store.refresh()
    .then(() => {
      // 首次进入自动选中第一个供应商，避免模型节空悬
      const first = store.providerList[0]
      if (!store.selectedProvider && first) {
        store.selectedProvider = first.name
      }
    })
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '加载供应商与模型清单失败')
    })
})

/** modal 互斥惯例：add 前先 remove 同 id（契约 §6） */
function openModal(id: string, component: Component) {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
  shell.Overlay.add({ id, kind: 'modal', component })
}

function onAddProvider() {
  store.openAddProvider()
  openModal(MODAL_PROVIDER_FORM, ProviderFormModal)
}

function onEditProvider(provider: ProviderInfo) {
  store.openEditProvider(provider)
  openModal(MODAL_PROVIDER_FORM, ProviderFormModal)
}

function onDeleteProvider(provider: ProviderInfo) {
  store.requestDeleteProvider(provider)
  openModal(MODAL_CONFIRM, ConfirmModal)
}

/** 添加模型：按 openAddModel 的路由结果分流（在线浏览 / 通用表单含 Ollama 选择器） */
function onAddModel() {
  store.openAddModel()
  if (store.onlineVendor) {
    openModal(MODAL_ONLINE_BROWSER, OnlineBrowserModal)
  } else {
    openModal(MODAL_MODEL_FORM, ModelFormModal)
  }
}

function onEditModel(model: ModelConfig) {
  store.openEditModel(model)
  openModal(MODAL_MODEL_FORM, ModelFormModal)
}

function onDeleteModel(model: ModelConfig) {
  store.requestDeleteModel(model)
  openModal(MODAL_CONFIRM, ConfirmModal)
}
</script>

<template>
  <div :class="$style.wrap">
    <!-- 上节：供应商品牌卡片横排（可左右滚动） -->
    <section>
      <div :class="$style.sectionHead">
        <span :class="$style.sectionTitle">供应商</span>
        <button type="button" class="mx-btn" @click="onAddProvider">
          <MxIcon name="lucide:plus" :size="16" />
          <span>添加供应商</span>
        </button>
      </div>
      <div v-if="store.providerList.length" :class="$style.strip">
        <div
          v-for="p in store.providerList"
          :key="p.name"
          role="button"
          tabindex="0"
          :class="$style.pCard"
          :data-active="p.name === store.selectedProvider ? 'true' : 'false'"
          @click="store.selectedProvider = p.name"
          @keydown.enter.prevent="store.selectedProvider = p.name"
          @keydown.space.prevent="store.selectedProvider = p.name"
        >
          <div :class="$style.pTop">
            <img v-if="providerIcon(p.name)" :src="providerIcon(p.name)" alt="" :class="$style.pIcon" />
            <span v-else :class="$style.pIconFallback">{{ p.name.charAt(0).toUpperCase() }}</span>
            <span :class="$style.pName">{{ formatProviderTitle(p) }}</span>
          </div>
          <div :class="$style.pMeta">
            <span :class="$style.pCount">{{ p.modelCount }} 个模型</span>
            <span v-if="!p.api_key" class="mx-tag" data-tone="warning">未配置</span>
          </div>
          <div :class="$style.hoverActions">
            <button type="button" class="mx-icon-btn" aria-label="编辑供应商" @click.stop="onEditProvider(p)">
              <MxIcon name="lucide:pencil" :size="16" />
            </button>
            <button type="button" class="mx-icon-btn" aria-label="删除供应商" @click.stop="onDeleteProvider(p)">
              <MxIcon name="lucide:trash-2" :size="16" />
            </button>
          </div>
        </div>
      </div>
      <p v-else :class="$style.hint">尚未添加供应商，点击右上角「添加供应商」开始配置。</p>
    </section>

    <!-- 下节：当前供应商的模型列表 -->
    <section v-if="store.providerList.length">
      <div :class="$style.sectionHead">
        <span :class="$style.sectionTitle">模型</span>
        <button
          v-if="store.selectedProvider"
          type="button"
          class="mx-btn mx-btn--primary"
          @click="onAddModel"
        >
          <MxIcon name="lucide:plus" :size="16" />
          <span>添加模型</span>
        </button>
      </div>
      <p v-if="!store.selectedProvider" :class="$style.hint">在上方选择一个供应商，查看并管理其模型。</p>
      <p v-else-if="store.currentModels.length === 0" :class="$style.hint">
        该供应商下还没有模型，点击「添加模型」开始配置。
      </p>
      <div v-else :class="$style.modelList">
        <div v-for="m in store.currentModels" :key="`${m.provider}/${m.name}`" :class="$style.mRow">
          <div :class="$style.mText">
            <div :class="$style.mTitleRow">
              <span :class="$style.mName">{{ m.title || m.name }}</span>
              <span v-if="m.enabled === false" class="mx-tag" data-tone="warning">已停用</span>
              <span v-if="m.is_local" class="mx-tag" data-tone="info">本地</span>
            </div>
            <span v-if="m.description" :class="$style.mDesc">{{ m.description }}</span>
            <span :class="$style.mPrice">{{ modelPriceLine(m) }}</span>
          </div>
          <div :class="$style.hoverActions">
            <button type="button" class="mx-icon-btn" aria-label="编辑模型" @click="onEditModel(m)">
              <MxIcon name="lucide:pencil" :size="16" />
            </button>
            <button type="button" class="mx-icon-btn" aria-label="删除模型" @click="onDeleteModel(m)">
              <MxIcon name="lucide:trash-2" :size="16" />
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style module>
/* 行容器：单行占满设置页内容区，纵向两节（同 market 管理行骨架） */
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-6);
  padding: var(--mx-space-4) 0;
}

.sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
}

.sectionTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

/* mx-btn 无内建图标间距：节头两枚"图标 + 文字"按钮统一补 flex 排布 */
.sectionHead :global(.mx-btn) {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
}

/* 卡片横排：横向滚动承载全部供应商（规格定稿），padding 2px 保 focus 环不被裁切 */
.strip {
  display: flex;
  gap: var(--mx-space-2);
  overflow-x: auto;
  padding: 2px;
  /* 隐藏水平滚动条（保留滚轮/触控板横向滚动） */
  scrollbar-width: none;
}

.strip::-webkit-scrollbar {
  display: none;
}

/* 供应商卡：选中描边（border-selected）+ 交互灰；动作按钮悬停/聚焦显现（opacity 保键盘可达） */
.pCard {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  width: 156px;
  box-sizing: border-box;
  padding: var(--mx-space-3);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.pCard:hover {
  background: var(--mx-hover);
}

.pCard:active {
  background: var(--mx-active);
}

.pCard:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.pCard[data-active='true'] {
  border-color: var(--mx-border-selected);
  background: var(--mx-hover);
}

.pTop {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-width: 0;
}

.pIcon {
  flex: none;
  width: 20px;
  height: 20px;
  object-fit: contain;
}

/* 未收录品牌的兜底：首字母圆角块（module 底 + 二级墨） */
.pIconFallback {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--mx-module);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.pName {
  min-width: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pMeta {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.pCount {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 悬停操作组：卡片/行右上角，opacity 淡入（visibility 会打断键盘可达） */
.hoverActions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.pCard:hover .hoverActions,
.pCard:focus-within .hoverActions,
.mRow:hover .hoverActions,
.mRow:focus-within .hoverActions {
  opacity: 1;
}

/* 模型列表：朴素行 + 0.5px 分隔线（不引入卡片嵌套） */
.modelList {
  display: flex;
  flex-direction: column;
}

.mRow {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3) var(--mx-space-2);
}

.mRow + .mRow {
  border-top: 0.5px solid var(--mx-separator-soft);
}

.mText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mTitleRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-width: 0;
}

.mName {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.mDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mPrice {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}
</style>
