<script setup lang="ts">
/**
 * 安装确认 modal（纯内容组件：卡片壳由 Overlay 容器提供）。
 * 信任模型硬纪律（契约 §18.6）：安装确认必须完整呈现 author / license /
 * permissions / 版本 / 体积，用户确认后才落盘安装。
 * 数据源统一走 daemon 市场服务（market.list kind=plugin），单条目单版本。
 */
import { computed } from 'vue'
import { useMarketStore } from '../store'

const store = useMarketStore()

const pending = computed(() => store.pendingConfirm)

function close() {
  store.cancelConfirm()
}

async function install() {
  await store.confirmInstall()
  // 成功才关（失败保留 modal，错误行内展示）
  if (!store.lastError) close()
}
</script>

<template>
  <div v-if="pending" :class="$style.body">
    <div :class="$style.titleRow">
      <span :class="$style.title">安装插件</span>
      <span :class="$style.name">{{ pending.pkg.name }}</span>
    </div>
    <p :class="$style.desc">{{ pending.pkg.description || '暂无描述' }}</p>

    <dl :class="$style.meta">
      <dt>版本</dt>
      <dd>{{ pending.pkg.version || '—' }}</dd>
      <dt>作者</dt>
      <dd>{{ pending.pkg.author || '—' }}</dd>
      <dt>许可证</dt>
      <dd>{{ pending.pkg.license || '—' }}</dd>
      <template v-if="pending.pkg.size">
        <dt>体积</dt>
        <dd>{{ pending.pkg.size }} 字节</dd>
      </template>
    </dl>

    <div v-if="(pending.pkg.permissions ?? []).length > 0" :class="$style.perm">
      <span :class="$style.permLabel">声明的权限（告知性，不构成授权）</span>
      <div :class="$style.permTags">
        <span v-for="p in pending.pkg.permissions" :key="p" class="mx-tag" data-tone="quiet">{{ p }}</span>
      </div>
    </div>

    <p v-if="store.lastError" :class="$style.error">{{ store.lastError }}</p>

    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">取消</button>
      <button
        type="button"
        class="mx-btn mx-btn--primary"
        :disabled="store.busyId !== null"
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
