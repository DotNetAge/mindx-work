<script setup lang="ts">
/**
 * 自建 AgentHub 地址 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 蓝本为 ElMessageBox.prompt：确认时规范化地址 + /healthz 连通性检查，仅检查通过才保存；
 * 失败在 modal 内停留（行内错误），保存成功推通知并关闭。
 */
import { ref } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { DAEMON_CONNECTION_SERVICE, type DaemonConnection } from '../runtime'
import { customUrl, checkChannelHealth, normalizeWsUrl, persistChannelUrl } from '../channel'
import { pushNotice } from '../notice'
import { MODAL_CONN_CHANNEL_URL } from '../ids'

const shell = useShell()
const conn = useService<DaemonConnection>(DAEMON_CONNECTION_SERVICE)

// 预填已保存的自建地址（模块级单例，行组件共享）
const urlInput = ref(customUrl.value)
const checking = ref(false)
const errorText = ref('')

function close(): void {
  shell.Overlay.remove(MODAL_CONN_CHANNEL_URL)
}

/** 检查并保存：连通性失败停留本 modal，成功落盘后通知并关闭 */
async function confirm(): Promise<void> {
  const url = normalizeWsUrl(urlInput.value)
  if (!url) {
    errorText.value = '请输入服务器地址'
    return
  }
  checking.value = true
  errorText.value = ''
  try {
    const ok = await checkChannelHealth(url)
    if (!ok) {
      errorText.value = '服务器连通性检查失败，请确认地址与服务器状态后重试'
      return
    }
    await persistChannelUrl(conn.call, url)
    close()
    pushNotice(shell, 'success', '手机连接配置已保存')
  } catch (err) {
    errorText.value = '保存手机连接配置失败' + (err instanceof Error ? `：${err.message}` : '')
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">自建 AgentHub 服务</span>
    <p :class="$style.desc">请输入自建 AgentHub 服务器的地址（ws:// 或 wss://），保存前将进行连通性检查。</p>
    <input
      v-model="urlInput"
      :class="$style.input"
      type="text"
      placeholder="ws://192.168.1.100:8080/ws"
      spellcheck="false"
      @keydown.enter.prevent="confirm()"
    />
    <p v-if="errorText" :class="$style.error">{{ errorText }}</p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">取消</button>
      <button type="button" class="mx-btn mx-btn--primary" :disabled="checking" @click="confirm()">
        <span v-if="checking" class="mx-text-loading">检查中…</span>
        <template v-else>检查并保存</template>
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

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.desc {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  line-height: 1.6;
}

.input {
  box-sizing: border-box;
  width: 100%;
  padding: var(--mx-space-2) var(--mx-space-3);
  font: var(--mx-font-caption);
  color: var(--mx-text);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  outline: none;
}

.input:focus {
  border-color: var(--mx-border-selected);
}

.input::placeholder {
  color: var(--mx-text-caption);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  line-height: 1.5;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
