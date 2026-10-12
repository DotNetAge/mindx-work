<script setup lang="ts">
/**
 * 添加连接 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 手动输入另一台设备的地址（发现列表扫不到时的兜底入口，如跨网段或 mDNS 被禁）。
 * 确认时规范化地址（补 ws:// 前缀、去尾斜杠）并保存——切到该设备并立即尝试连接；
 * 连接是异步过程，结果由设备行的状态（已连接/离线）实时反映，本 modal 保存即关。
 * 2026-10-11 新建：原 connection 插件「远程机器地址」modal 的设备分组变体。
 */
import { ref } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { pushNotice } from '../notice'
import { MODAL_DEVICE_ADDRESS } from '../ids'

/** 地址规范化：去空白与尾斜杠；缺少协议前缀时补 ws://（原 phoneChannel 同款，单处使用故内联） */
function normalizeWsUrl(raw: string): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^wss?:\/\//i.test(url)) url = 'ws://' + url
  return url
}

const shell = useShell()
/** daemon 连接服务（消费侧仅声明所需形状；插件间禁止 import） */
const conn = useService<{
  readonly mode: 'local' | 'remote'
  readonly remoteUrl: string
  switchMode(mode: 'local' | 'remote'): void
  setRemoteUrl(url: string): void
}>('daemon.connection')

const urlInput = ref(conn.remoteUrl)
const errorText = ref('')

function close(): void {
  shell.Overlay.remove(MODAL_DEVICE_ADDRESS)
}

/** 保存地址并切到该设备：先写地址再切模式（远程模式下写地址即已重连，切模式幂等早退） */
async function confirm(): Promise<void> {
  const url = normalizeWsUrl(urlInput.value)
  if (!url) {
    errorText.value = '请输入设备地址'
    return
  }
  try {
    conn.setRemoteUrl(url)
    conn.switchMode('remote')
    close()
    pushNotice(shell, 'success', '正在连接该设备，连接结果将在设备列表中显示')
  } catch (err) {
    errorText.value = '保存设备地址失败' + (err instanceof Error ? `：${err.message}` : '')
  }
}
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">添加连接</span>
    <p :class="$style.desc">请输入另一台设备的地址（ws:// 或 wss://），保存后将立即尝试连接。</p>
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
      <button type="button" class="mx-btn mx-btn--primary" @click="confirm()">保存并连接</button>
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
