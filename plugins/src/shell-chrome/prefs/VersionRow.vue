<script setup lang="ts">
/**
 * 版本行（承接自 demo，更新机制定稿 2026-10-02 扩展）：
 * 当前版本运行时读取（宿主桥 updater 快照，不再硬编码）+ 手动检查更新入口。
 * 状态文案随主进程事件推送刷新；disabled 构建（dev / ad-hoc 未公证）检查时给出原因。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from '@mindx-work/ui-shell-vue'
import type { UpdaterSnapshot } from '@mindx-work/ui-shell'

const version = ref('')
const statusText = ref('')
let unsubscribe: (() => void) | null = null

const STATUS_TEXT: Record<UpdaterSnapshot['status'], string> = {
  idle: '',
  checking: '正在检查更新…',
  downloading: '正在下载更新…',
  ready: '新版已就绪，重启后安装',
}

function apply(snap: UpdaterSnapshot | null): void {
  if (!snap) return
  version.value = `v${snap.currentVersion}`
  statusText.value = snap.availableVersion && snap.status === 'downloading'
    ? `发现新版本 v${snap.availableVersion}，${STATUS_TEXT[snap.status]}`
    : STATUS_TEXT[snap.status]
}

onMounted(async () => {
  const bridge = window.mxDesktop?.updater
  if (!bridge) {
    version.value = 'v0.1.0' // 纯 Web 无宿主桥：回退 package.json 版本号
    return
  }
  apply(await bridge.getState())
  unsubscribe = bridge.onEvent(apply)
})

onUnmounted(() => unsubscribe?.())

async function check(): Promise<void> {
  const bridge = window.mxDesktop?.updater
  if (!bridge) return
  const result = await bridge.checkNow()
  if (!result.ok) ElMessage.info(result.reason ?? '无法检查更新')
}
</script>

<template>
  <div class="mx-pref-row">
    <span class="mx-pref-label">版本</span>
    <span :class="$style.value">
      <span>{{ version }}</span>
      <span v-if="statusText" :class="$style.status">{{ statusText }}</span>
      <button type="button" :class="$style.check" @click="check">检查更新</button>
    </span>
  </div>
</template>

<style module>
.value {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.status {
  color: var(--mx-text-tertiary);
}

.check {
  padding: 2px 10px;
  box-sizing: border-box;
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.check:hover {
  background: var(--mx-hover);
}

.check:active {
  background: var(--mx-active);
}

.check:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}
</style>
