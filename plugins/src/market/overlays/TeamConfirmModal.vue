<script setup lang="ts">
/**
 * 团队安装确认 modal（纯内容组件：卡片壳由 Overlay 容器提供）。
 * 覆盖安装共用：文案与确认按钮文字取挂载时的待确认快照
 * （modal 每次打开重新挂载）；确认 = 执行动作后关闭并推成功通知；
 * 失败关闭并推错误通知；取消仅关闭不执行。
 */
import { ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore } from '../store'
import { pushNotice } from '../notice'
import { MODAL_TEAM_CONFIRM } from '../ids'

const store = useMarketStore()
const shell = useShell()

// setup 期快照：打开前 requestTeamConfirm 已写入待确认内容
const pending = store.teamPendingConfirm
const busy = ref(false)

function close(): void {
  shell.Overlay.remove(MODAL_TEAM_CONFIRM)
}

function cancel(): void {
  store.cancelTeamConfirm()
  close()
}

async function confirm(): Promise<void> {
  busy.value = true
  try {
    const text = await store.runTeamConfirm()
    close()
    pushNotice(shell, 'success', text ?? '操作完成')
  } catch (err) {
    close()
    pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="pending" :class="$style.body">
    <span :class="$style.title">{{ pending.title }}</span>
    <p :class="$style.message">{{ pending.message }}</p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="cancel">取消</button>
      <button type="button" class="mx-btn mx-btn--primary" :disabled="busy" @click="confirm()">
        <span v-if="busy" class="mx-text-loading">执行中…</span>
        <template v-else>{{ pending.confirmText }}</template>
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

.message {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  margin: 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
