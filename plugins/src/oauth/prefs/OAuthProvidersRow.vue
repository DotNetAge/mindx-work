<script setup lang="ts">
/**
 * OAuth 提供商设置行（设置页「OAuth 提供商」唯一行）：
 * 提供商状态清单（title + 标识 + 已配置/未配置 + 授权方式）+ 操作入口——
 * 未配置（第二层模板）走「填入 Client ID」弹窗写凭据库；已配置走
 * 「去授权」弹窗（流程事件驱动，详见 flow.ts）。
 */
import { onMounted, ref, watch } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import type { DaemonConnection } from '../../connection/runtime'
import { fetchProviders, type OAuthProviderView } from '../runtime'
import { beginFlow, oauthConfigureTarget, oauthProvidersVersion } from '../flow'
import { MODAL_OAUTH_AUTHORIZE, MODAL_OAUTH_CONFIGURE } from '../ids'
import OAuthAuthorizeModal from '../overlays/OAuthAuthorizeModal.vue'
import OAuthConfigureModal from '../overlays/OAuthConfigureModal.vue'

const shell = useShell()
// daemon.connection 以服务形式消费（connection 插件先于本插件装配）
const conn = useService<DaemonConnection>('daemon.connection')

const loading = ref(false)
const error = ref('')
const providers = ref<OAuthProviderView[]>([])

/** 授权方式客户文案（interaction 由 daemon 带出，壳零推导） */
function interactionText(item: OAuthProviderView): string {
  switch (item.interaction) {
    case 'callback':
      return '浏览器授权'
    case 'device_code':
      return '设备码授权'
    case 'user_code':
      return '用户码授权'
    default:
      return item.interaction
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    providers.value = await fetchProviders(conn.call)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法获取提供商列表，请确认智能主机已连接'
  } finally {
    loading.value = false
  }
}

function openAuthorize(item: OAuthProviderView): void {
  beginFlow(item.name, item.title)
  if (shell.Overlay.has(MODAL_OAUTH_AUTHORIZE)) shell.Overlay.remove(MODAL_OAUTH_AUTHORIZE)
  shell.Overlay.add({ id: MODAL_OAUTH_AUTHORIZE, kind: 'modal', component: OAuthAuthorizeModal })
}

function openConfigure(item: OAuthProviderView): void {
  oauthConfigureTarget.name = item.name
  oauthConfigureTarget.title = item.title
  if (shell.Overlay.has(MODAL_OAUTH_CONFIGURE)) shell.Overlay.remove(MODAL_OAUTH_CONFIGURE)
  shell.Overlay.add({ id: MODAL_OAUTH_CONFIGURE, kind: 'modal', component: OAuthConfigureModal })
}

onMounted(() => {
  void refresh()
})

// 配置弹窗保存成功后自增版本号，此处联动刷新清单
watch(oauthProvidersVersion, () => {
  void refresh()
})
</script>

<template>
  <div :class="$style.wrap">
    <div class="mx-pref-row">
      <div class="mx-pref-label">
        <span class="mx-pref-title">OAuth 提供商</span>
        <span class="mx-pref-desc">技能与连接器授权所需的提供商注册表。标记「未配置」的平台需要先填入您注册应用得到的 Client ID，再发起授权。</span>
      </div>
    </div>

    <div v-if="loading && providers.length === 0" :class="$style.hint">正在获取提供商列表…</div>
    <div v-else-if="error" :class="$style.error">{{ error }}</div>
    <div v-else-if="providers.length === 0" :class="$style.hint">暂无可用提供商</div>

    <div v-else :class="$style.list">
      <div v-for="item in providers" :key="item.name" :class="$style.item">
        <div :class="$style.info">
          <span :class="$style.title">{{ item.title || item.name }}</span>
          <span :class="$style.meta">
            <span class="mx-dot" :style="{ color: item.configured ? 'var(--mx-state-success)' : 'var(--mx-state-warn)' }" />
            {{ item.configured ? '已配置' : '未配置' }}
            <i :class="$style.sep">·</i>
            {{ interactionText(item) }}
          </span>
        </div>
        <div :class="$style.actions">
          <button v-if="item.configured" type="button" class="mx-btn" @click="openAuthorize(item)">去授权</button>
          <button v-else type="button" class="mx-btn mx-btn--primary" @click="openConfigure(item)">填入 Client ID</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.list {
  display: flex;
  flex-direction: column;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3) 0;
}

.item + .item {
  border-top: 0.5px solid var(--mx-separator-soft);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.title {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.meta {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.sep {
  font-style: normal;
  color: var(--mx-text-tertiary);
}

.actions {
  flex: none;
  display: flex;
  gap: var(--mx-space-2);
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  word-break: break-all;
}
</style>
