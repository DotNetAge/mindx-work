<script setup lang="ts">
/**
 * 远程机器地址行：仅远程模式显示（批注：只有选择远程时才显示）。
 * 展示当前远程地址 + 修改入口（modal：规范化地址后保存，保存即重连）。
 */
import { computed } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { DAEMON_CONNECTION_SERVICE } from '../runtime'
import type { DaemonConnection } from '../runtime'
import { MODAL_CONN_REMOTE_URL } from '../ids'
import RemoteUrlModal from '../overlays/RemoteUrlModal.vue'

const shell = useShell()
const connection = useService<DaemonConnection>(DAEMON_CONNECTION_SERVICE)

const url = computed(() => connection.remoteUrl)

function openEditor(): void {
  if (shell.Overlay.has(MODAL_CONN_REMOTE_URL)) shell.Overlay.remove(MODAL_CONN_REMOTE_URL)
  shell.Overlay.add({ id: MODAL_CONN_REMOTE_URL, kind: 'modal', component: RemoteUrlModal })
}
</script>

<template>
  <div v-if="connection.mode === 'remote'" class="mx-pref-row">
    <div class="mx-pref-label">
      <span class="mx-pref-title">远程机器地址</span>
      <span :class="$style.url" :data-empty="!url">{{ url || '尚未配置，点击修改填写' }}</span>
    </div>
    <button type="button" class="mx-btn" @click="openEditor()">修改</button>
  </div>
</template>

<style module>
.url {
  font: 400 12px/18px ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  color: var(--mx-text);
  word-break: break-all;
}

/* 未配置时占位提示用次级墨色（与正常地址区分） */
.url[data-empty='true'] {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}
</style>
