<script setup lang="ts">
/**
 * 远程机器地址 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 确认时规范化地址（补 ws:// 前缀、去尾斜杠）并保存——保存即按新地址重连（远程模式下），
 * 连接结果在「连接方式」行描述实时反映。远程地址是连接前置条件，无连通性预检（daemon 无健康检查端点）。
 */
import { ref } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { DAEMON_CONNECTION_SERVICE } from '../runtime'
import type { DaemonConnection } from '../runtime'
import { normalizeWsUrl } from '../channel'
import { pushNotice } from '../notice'
import { MODAL_CONN_REMOTE_URL } from '../ids'

const shell = useShell()
const connection = useService<DaemonConnection>(DAEMON_CONNECTION_SERVICE)

const urlInput = ref(connection.remoteUrl)
const errorText = ref('')

function close(): void {
  shell.Overlay.remove(MODAL_CONN_REMOTE_URL)
}

async function confirm(): Promise<void> {
  const url = normalizeWsUrl(urlInput.value)
  if (!url) {
    errorText.value = '请输入远程机器地址'
    return
  }
  try {
    connection.setRemoteUrl(url)
    close()
    pushNotice(shell, 'success', '远程机器地址已保存')
  } catch (err) {
    errorText.value = '保存远程机器地址失败' + (err instanceof Error ? `：${err.message}` : '')
  }
}
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">远程机器地址</span>
    <p :class="$style.desc">请输入远程智能主机的地址（ws:// 或 wss://），保存后将立即尝试连接。</p>
    <input
      v-model="urlInput"
      :class="$style.input"
      type="text"
      placeholder="ws://192.168.1.100:1314/ws"
      spellcheck="false"
      @keydown.enter.prevent="confirm()"
    />
    <p v-if="errorText" :class="$style.error">{{ errorText }}</p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">取消</button>
      <button type="button" class="mx-btn mx-btn--primary" @click="confirm()">保存</button>
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
