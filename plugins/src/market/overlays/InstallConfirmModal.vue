<script setup lang="ts">
/**
 * 安装确认 modal（纯内容组件：卡片壳由 Overlay 容器提供）。
 * 信任模型硬纪律（契约 §18.6）：安装确认必须完整呈现 author / url / repo /
 * license / permissions / versions，用户确认后才落盘安装。
 */
import { computed, ref } from 'vue'
import type { MarketVersionView } from '@mindx-work/ui-shell'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore } from '../store'
import { OVERLAY_CONFIRM } from '../ids'

const store = useMarketStore()
const shell = useShell()

const pending = computed(() => store.pendingConfirm)
/** 待安装版本（缺省最新版，多版本时可改选） */
const selected = ref<MarketVersionView | null>(pending.value?.versions[0] ?? null)

function close() {
  store.cancelConfirm()
  shell.Overlay.remove(OVERLAY_CONFIRM)
}

async function install() {
  if (!selected.value) return
  await store.confirmInstall(selected.value)
  // 成功才关（失败保留 modal，错误行内展示）
  if (!store.lastError) close()
}
</script>

<template>
  <div v-if="pending" :class="$style.body">
    <div :class="$style.titleRow">
      <span :class="$style.title">安装插件</span>
      <span :class="$style.name">{{ pending.entry.name }}</span>
    </div>
    <p :class="$style.desc">{{ pending.entry.description }}</p>

    <dl :class="$style.meta">
      <dt>作者</dt>
      <dd>{{ pending.entry.author }}</dd>
      <dt>许可证</dt>
      <dd>{{ pending.entry.license }}</dd>
      <template v-if="pending.entry.url">
        <dt>网站</dt>
        <dd>{{ pending.entry.url }}</dd>
      </template>
      <template v-if="pending.entry.repo">
        <dt>源码库</dt>
        <dd>{{ pending.entry.repo }}</dd>
      </template>
    </dl>

    <div v-if="pending.entry.permissions.length > 0" :class="$style.perm">
      <span :class="$style.permLabel">声明的权限（告知性，不构成授权）</span>
      <div :class="$style.permTags">
        <span v-for="p in pending.entry.permissions" :key="p" class="mx-tag" data-tone="quiet">{{ p }}</span>
      </div>
    </div>

    <div :class="$style.versions">
      <span :class="$style.permLabel">版本</span>
      <div :class="$style.versionList">
        <button
          v-for="v in pending.versions"
          :key="v.version"
          type="button"
          :class="$style.versionCell"
          :data-active="selected?.version === v.version ? 'true' : 'false'"
          @click="selected = v"
        >
          <MxIcon v-if="selected?.version === v.version" name="lucide:check" :size="16" />
          <span>{{ v.version }}</span>
        </button>
      </div>
    </div>

    <p v-if="store.lastError" :class="$style.error">{{ store.lastError }}</p>

    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">取消</button>
      <button
        type="button"
        class="mx-btn mx-btn--primary"
        :disabled="!selected || store.busyId !== null"
        @click="install()"
      >
        <span v-if="store.busyId" class="mx-text-loading">安装中…</span>
        <template v-else>安装</template>
      </button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.titleRow {
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-2);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.name {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.desc {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

/* 元数据双列：label 三级墨 / value 主墨，左对齐窄列 */
.meta {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: var(--mx-space-1) var(--mx-space-3);
  margin: 0;
}

.meta dt {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.meta dd {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text);
  overflow-wrap: break-word;
}

.perm {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.permLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.permTags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mx-space-1);
}

.versions {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.versionList {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mx-space-1);
}

/* 版本选择格：选中描边（对齐外观三卡选中语义） */
.versionCell {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text);
  background: transparent;
  border: 0.5px solid var(--mx-border-l4);
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.versionCell:hover {
  background: var(--mx-hover);
}

.versionCell:active {
  background: var(--mx-active);
}

.versionCell:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.versionCell:disabled {
  opacity: 0.4;
  cursor: default;
}

.versionCell[data-active='true'] {
  border-color: var(--mx-border-selected);
  background: var(--mx-hover);
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
