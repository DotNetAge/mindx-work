<script setup lang="ts">
/**
 * 连接器管理行："连接器"设置页唯一自定义行，承载完整管理器（models 管理行先例）。
 * 卡片网格列出全部 MCP 连接器：每卡右侧开关控制 enabled（热生效）；
 * 编排归组件（Overlay 开合、banner 推送）；数据与 RPC 归 store。
 */
import { computed, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useConnectorsStore } from '../store'
import { pushNotice } from '../notice'
import { MODAL_CONNECTOR_CONFIRM, MODAL_CONNECTOR_FORM } from '../ids'
import type { MCPServerListEntry } from '../types'
import ConnectorFormModal from '../overlays/ConnectorFormModal.vue'
import ConfirmModal from '../overlays/ConfirmModal.vue'

const store = useConnectorsStore()
const shell = useShell()

onMounted(() => {
  store.refresh().catch((err: unknown) => {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '加载连接器清单失败')
  })
})

/** modal 互斥惯例：add 前先 remove 同 id（契约 §6） */
function openModal(id: string, component: Component) {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
  shell.Overlay.add({ id, kind: 'modal', component })
}

function onAdd() {
  store.openAdd()
  openModal(MODAL_CONNECTOR_FORM, ConnectorFormModal)
}

function onEdit(server: MCPServerListEntry) {
  store.openEdit(server)
  openModal(MODAL_CONNECTOR_FORM, ConnectorFormModal)
}

function onRemove(server: MCPServerListEntry) {
  store.requestRemove(server)
  openModal(MODAL_CONNECTOR_CONFIRM, ConfirmModal)
}

// ── 展示派生（纯展示函数，归视图） ──

/** 展示名：优先 title，回退 name */
function displayName(s: MCPServerListEntry): string {
  return s.title?.trim() || s.name
}

/** 描述：优先人话描述，无则回退命令/地址等技术标识 */
function descOf(s: MCPServerListEntry): string {
  if (s.description?.trim()) return s.description.trim()
  if (s.type === 'stdio') {
    return [s.command, ...(s.args || [])].filter(Boolean).join(' ')
  }
  return s.url || ''
}

/** 卡片头像字：server 名首字（大写） */
function avatarOf(name: string): string {
  return (name || '?').charAt(0).toUpperCase()
}

/** 类型标签：stdio=本地进程，sse/http=远程服务（用户不懂传输协议术语） */
function typeLabel(type: string): string {
  return type === 'stdio' ? '本地进程' : '远程服务'
}

/** 搜索覆盖展示名 / 名称 / 命令或地址 */
const searchQuery = ref('')
const filteredServers = computed<MCPServerListEntry[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return store.servers
  return store.servers.filter((s) => [s.name, displayName(s), descOf(s)].join(' ').toLowerCase().includes(q))
})

/** 切换开关：请求期间开关内转圈（含开启后自动测连全程）；未通过仅警告（不回滚开关） */
function onToggle(server: MCPServerListEntry, enabled: boolean) {
  void store.toggle(server, enabled).then((warning) => {
    if (warning) {
      pushNotice(shell, 'warning', `「${displayName(server)}」已启用，但${warning}`)
    } else {
      pushNotice(shell, 'success', enabled ? `「${displayName(server)}」已启用` : `「${displayName(server)}」已停用`)
    }
  }).catch((err: unknown) => {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '切换启用状态失败')
  })
}

async function onRefresh() {
  try {
    await store.refresh()
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '加载连接器清单失败')
  }
}
</script>

<template>
  <div :class="$style.wrap">
    <!-- 节头：标题 + 添加按钮 -->
    <div :class="$style.sectionHead">
      <div :class="$style.headText">
        <span :class="$style.sectionTitle">连接器</span>
        <span :class="$style.sectionHint">管理 MCP 连接器；启用后即可在会话中使用其工具</span>
      </div>
      <button type="button" class="mx-btn mx-btn--primary" @click="onAdd">
        <MxIcon name="lucide:plus" :size="16" />
        <span>添加连接器</span>
      </button>
    </div>

    <!-- 工具栏：搜索 + 刷新 + 计数 -->
    <div :class="$style.toolbar">
      <input v-model="searchQuery" class="mx-input" :class="$style.search" placeholder="搜索连接器名称或描述" />
      <button type="button" class="mx-icon-btn" aria-label="刷新清单" @click="onRefresh">
        <MxIcon name="lucide:rotate-cw" :size="16" />
      </button>
      <span :class="$style.count">{{ filteredServers.length }} 个连接器</span>
    </div>

    <!-- 内容区 -->
    <p v-if="!store.loaded" :class="[$style.hint, 'mx-text-loading']">正在加载连接器清单…</p>
    <div v-else-if="filteredServers.length > 0" :class="$style.grid">
      <div
        v-for="server in filteredServers"
        :key="server.name"
        :class="$style.card"
        :data-enabled="server.enabled ? 'true' : 'false'"
      >
        <div :class="$style.cardTop">
          <span :class="$style.avatar">{{ avatarOf(server.name) }}</span>
          <div :class="$style.titleCol">
            <span :class="$style.name" :title="server.name">{{ displayName(server) }}</span>
            <span :class="$style.id">{{ server.name }}</span>
          </div>
          <button
            class="mx-switch"
            :class="{ [$style.switchLoading]: store.switching === server.name }"
            role="switch"
            :aria-checked="server.enabled ? 'true' : 'false'"
            :aria-busy="store.switching === server.name ? 'true' : undefined"
            :disabled="store.switching === server.name"
            @click="onToggle(server, !server.enabled)"
          >
            <span class="mx-switch-thumb" :class="{ [$style.thumbHidden]: store.switching === server.name }" />
            <span v-if="store.switching === server.name" :class="$style.switchLoader" />
          </button>
        </div>
        <p :class="$style.desc" :title="descOf(server)">{{ descOf(server) || '—' }}</p>
        <div :class="$style.cardFoot">
          <span class="mx-tag" data-tone="neutral">{{ typeLabel(server.type) }}</span>
          <div :class="$style.cardActions">
            <button type="button" class="mx-icon-btn" aria-label="编辑连接器" @click="onEdit(server)">
              <MxIcon name="lucide:settings" :size="16" />
            </button>
            <button type="button" class="mx-icon-btn" aria-label="删除连接器" @click="onRemove(server)">
              <MxIcon name="lucide:trash-2" :size="16" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-else :class="$style.hint">尚未添加连接器，点击右上角「添加连接器」开始配置。</p>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-4) 0;
}

.sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.headText {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.sectionTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.sectionHint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.sectionHead :global(.mx-btn) {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.search {
  width: 240px;
}

.count {
  margin-left: auto;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
}

/* 卡片网格：自适应列宽（与源组件同布局口径） */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--mx-space-3);
  align-content: start;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  transition: border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.card:hover {
  border-color: var(--mx-border-selected);
}

/* 已停用：仅文字降弱示意（开关状态之外的辅助视觉） */
.card[data-enabled='false'] .name,
.card[data-enabled='false'] .desc {
  opacity: 0.55;
}

.cardTop {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--mx-radius-control);
  background: var(--mx-module);
  font: var(--mx-font-heading);
  color: var(--mx-text-secondary);
}

.titleCol {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.id {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.desc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-1);
}

.cardActions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 切换中：覆盖禁用降透明度，保证 loader 转圈清晰 */
.switchLoading {
  opacity: 1 !important;
}

/* loader：12px 圆环居中转圈（白系在 accent/灰轨道上均清晰；thumb 同步隐藏） */
.switchLoader {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--mx-text-on-accent) 30%, transparent);
  border-top-color: var(--mx-text-on-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.thumbHidden {
  opacity: 0;
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}
</style>
