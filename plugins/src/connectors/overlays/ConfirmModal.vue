<script setup lang="ts">
/**
 * 删除确认 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 内容取挂载时的待确认快照（modal 每次打开重新挂载，快照即当前待确认项）；
 * 确认 = 执行动作后关闭并推成功通知；失败关闭并推错误通知；取消仅关闭不执行。
 * 插件间禁止 import，本文件为 connectors 插件自带副本（范式同 models）。
 */
import { ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useConnectorsStore } from '../store'
import { pushNotice } from '../notice'
import { MODAL_CONNECTOR_CONFIRM } from '../ids'

const store = useConnectorsStore()
const shell = useShell()

// setup 期快照：打开前 requestRemove 已写入待确认内容
const pending = store.pendingConfirm
const busy = ref(false)

function close(): void {
  shell.Overlay.remove(MODAL_CONNECTOR_CONFIRM)
}

function cancel(): void {
  store.cancelConfirm()
  close()
}

async function confirm(): Promise<void> {
  busy.value = true
  try {
    const text = await store.runConfirm()
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
        <template v-else>删除</template>
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
