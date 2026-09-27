<script setup lang="ts">
/**
 * 连接方式行：Switch 双模式（左本地/右远程）+ 描述按连接状态实时切换。
 * 切远程且尚未配置地址时：模式照切（Switch 即变），地址行引导配置，连接暂保持本地端点。
 * 描述文案：连接成功按批注（本地「已连接本地智能体主机」/远程「已进入远程智能体主机（地址）」），
 * 进行中/失败沿用同句式补全；错误直接展示 lastError。
 */
import { computed } from 'vue'
import { useService } from '@mindx-work/ui-shell-vue'
import { DAEMON_CONNECTION_SERVICE } from '../runtime'
import type { DaemonConnection } from '../runtime'

const connection = useService<DaemonConnection>(DAEMON_CONNECTION_SERVICE)

const isRemote = computed(() => connection.mode === 'remote')
const connected = computed(() => connection.state === 'connected')
const isConnecting = computed(() => connection.state === 'connecting' || connection.state === 'reconnecting')

/** 描述文案（错误态红字展示 lastError，见模板 data-error；连接进行中走流光文字） */
const desc = computed(() => {
  if (connection.state === 'error') return connection.lastError || '连接出错'
  if (isRemote.value && !connection.remoteUrl) return '请先配置远程机器地址'
  if (connected.value) {
    return isRemote.value
      ? `已进入远程智能体主机（${connection.remoteUrl}）`
      : '已连接本地智能体主机'
  }
  if (isConnecting.value) {
    return isRemote.value ? '正在进入远程智能体主机…' : '正在连接本地智能体主机…'
  }
  return '未连接'
})

function onToggle(): void {
  connection.switchMode(isRemote.value ? 'local' : 'remote')
}
</script>

<template>
  <div class="mx-pref-row">
    <div class="mx-pref-label">
      <span class="mx-pref-title">连接方式</span>
      <span :class="[$style.desc, { 'mx-text-loading': isConnecting }]" :data-error="connection.state === 'error'">{{ desc }}</span>
    </div>
    <span :class="$style.modeSwitch">
      <span :class="$style.modeLabel" :data-active="!isRemote">本地</span>
      <button class="mx-switch" role="switch" :aria-checked="isRemote" @click="onToggle()">
        <span class="mx-switch-thumb" />
      </button>
      <span :class="$style.modeLabel" :data-active="isRemote">远程</span>
    </span>
  </div>
</template>

<style module>
/* 描述：复刻 mx-pref-desc 排版 + 错误态红字（lastError 实时可见） */
.desc {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.desc[data-error='true'] {
  color: var(--mx-state-error);
}

.modeSwitch {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
}

/* 左右模式标签：当前模式主墨色，另一侧次级墨（批注：左为本地 右为远程） */
.modeLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.modeLabel[data-active='true'] {
  color: var(--mx-text);
}
</style>
