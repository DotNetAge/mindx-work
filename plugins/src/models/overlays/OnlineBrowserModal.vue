<script setup lang="ts">
/**
 * 在线模型浏览 modal：七家供应商共用一条目（按 store.onlineVendor 取配置）。
 * 打开即拉取清单；行内展示 免费标记 / 上下文 / 输入输出价格（formatCost ￥0 兜底）；
 * 添加成功不关闭（可连续添加），已存在于本地的模型按钮灰显。
 */
import { computed, onMounted, ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { ONLINE_VENDORS, useModelsStore } from '../store'
import { pushNotice } from '../notice'
import { formatContextSize, formatCost } from '../format'
import { MODAL_ONLINE_BROWSER } from '../ids'
import type { OnlineModelInfo } from '../types'

const store = useModelsStore()
const shell = useShell()

const vendor = computed(() => ONLINE_VENDORS.find((v) => v.id === store.onlineVendor))
const busyId = ref('')

onMounted(() => {
  store.fetchOnline().catch((err: unknown) => {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '拉取在线模型清单失败')
  })
})

/** 本地是否已存在同 provider 同名模型 */
function isAdded(item: OnlineModelInfo): boolean {
  return store.models.some((m) => m.provider === store.selectedProvider && m.name === item.id)
}

async function add(item: OnlineModelInfo): Promise<void> {
  busyId.value = item.id
  try {
    await store.addOnlineModel(item)
    pushNotice(shell, 'success', `模型「${item.title || item.id}」已添加`)
  } catch (err) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '添加模型失败')
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">{{ vendor?.label ?? '在线模型' }}</span>
    <p v-if="store.onlineLoading" :class="$style.hint">正在拉取在线模型清单…</p>
    <div v-else-if="store.onlineModels.length" :class="$style.list">
      <div v-for="item in store.onlineModels" :key="item.id" :class="$style.row">
        <div :class="$style.rowText">
          <div :class="$style.rowTitle">
            <span :class="$style.rowName">{{ item.title || item.id }}</span>
            <span v-if="item.free" class="mx-tag" data-tone="success">免费</span>
          </div>
          <span v-if="item.description" :class="$style.rowDesc">{{ item.description }}</span>
          <span :class="$style.rowPrice">
            上下文 {{ formatContextSize(item.context_length) }} · 输入 {{ formatCost(item.cost_per_1m_in) }}/1M · 输出 {{ formatCost(item.cost_per_1m_out) }}/1M
          </span>
        </div>
        <button
          type="button"
          class="mx-btn"
          :disabled="isAdded(item) || busyId === item.id"
          @click="add(item)"
        >
          {{ isAdded(item) ? '已添加' : '添加' }}
        </button>
      </div>
    </div>
    <p v-else :class="$style.hint">该供应商暂无可用模型。</p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="shell.Overlay.remove(MODAL_ONLINE_BROWSER)">关闭</button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}

/* 清单：纵向可滚动（modal 内容区）；行间 0.5px 分隔线 */
.list {
  display: flex;
  flex-direction: column;
  max-height: min(380px, 46vh);
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-2) 0;
}

.row + .row {
  border-top: 0.5px solid var(--mx-separator-soft);
}

.rowText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rowTitle {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-width: 0;
}

.rowName {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.rowDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rowPrice {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
