<script setup lang="ts">
/**
 * 添加连接 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 手动输入另一台设备的地址（发现列表扫不到时的兜底入口，如跨网段、
 * 云服务器等无屏幕主机）。确认时规范化地址（补 ws:// 前缀、去尾斜杠）保存——
 * 切到该设备并立即尝试连接；结果由设备行的状态实时反映，本 modal 保存即关。
 * 配对码（可选）：对方是无屏幕主机（没有界面可以点「允许」）时，先在那台
 * 机器上运行 mindx pair 生成一次性配对码，连同地址一起填写——校验通过即
 * 完成接入，此后重连不再需要任何确认。同一网络的设备在列表点「连接」即可，
 * 无需配对码。
 */
import { ref } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { pushNotice } from '../notice'
import { MODAL_DEVICE_ADDRESS } from '../ids'

/** 地址规范化：用户只输「地址:端口」，格式由这里拼——
 * 去空白与尾斜杠；缺协议补 ws://；缺路径补 daemon 端点 /ws
 * （与附近设备自动扫描直连同款拼接，AccountSheet deviceUrl；
 * 已带路径的完整地址沿用用户写的路径） */
function normalizeWsUrl(raw: string): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^wss?:\/\//i.test(url)) url = 'ws://' + url
  const rest = url.replace(/^wss?:\/\//i, '')
  if (!rest.includes('/')) url += '/ws'
  return url
}

const shell = useShell()
/** daemon 连接服务（消费侧仅声明所需形状；插件间禁止 import） */
const conn = useService<{
  readonly mode: 'local' | 'remote'
  readonly remoteUrl: string
  switchMode(mode: 'local' | 'remote'): void
  setRemoteUrl(url: string, pairCode?: string): void
}>('daemon.connection')

const urlInput = ref(conn.remoteUrl)
const pairInput = ref('')
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
    conn.setRemoteUrl(url, pairInput.value.trim() || undefined)
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
    <p :class="$style.desc">输入另一台设备的地址（例如 192.168.1.100:1314），保存后立即尝试连接。</p>
    <input
      v-model="urlInput"
      :class="$style.input"
      type="text"
      placeholder="192.168.1.100:1314"
      spellcheck="false"
      @keydown.enter.prevent="confirm()"
    />
    <p :class="$style.desc">
      对方是无屏幕的主机（如服务器）？先在那台机器上运行
      <code :class="$style.cmd">mindx pair</code>
      生成配对码，填在下面。同一网络的设备直接在列表点连接，不用填。
    </p>
    <input
      v-model="pairInput"
      :class="$style.input"
      type="text"
      inputmode="numeric"
      maxlength="6"
      placeholder="配对码（可选，6 位数字）"
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

.cmd {
  font-family: var(--mx-font-mono);
  color: var(--mx-text);
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
