<script setup lang="ts">
/**
 * 设备接入请求弹窗（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 展示请求接入的设备名，三个动作：
 *  - 同意：该设备在接入列表登记长期凭据（重连免确认）；
 *  - 拒绝：请求短时间内失效，对方可再次申请；
 *  - 拒绝且不再询问：该设备进入「已拒绝」名单，此后重试静默拒绝不再弹窗，
 *    可在账户面板的已拒绝分组里解除。
 * 动作失败停留本弹窗（行内错误），成功即关。
 * Esc/遮罩关闭 = 暂不处理（请求超时后自动失效），引擎不重复弹。
 * 2026-10-11 新建：设备接入闸（Mac 间互连）的桌面端审批入口，范式同 phone-pair PairRequestModal。
 */
import { ref } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { pairRequest, clearPairRequest } from '../devgate'
import { MODAL_DEVICE_REQUEST } from '../ids'

const shell = useShell()
/** daemon 连接服务（消费侧仅声明所需形状；插件间禁止 import） */
const conn = useService<{ call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> }>(
  'daemon.connection',
)

/** setup 期快照：弹窗打开前引擎已写入待审批请求 */
const req = pairRequest.value
const busy = ref(false)
const errorText = ref('')

function close(): void {
  shell.Overlay.remove(MODAL_DEVICE_REQUEST)
}

/** 处理请求（approve=true 同意；block=true 拒绝且不再询问）：
 *  成功关弹窗并消费请求，失败停留行内提示 */
async function decide(approve: boolean, block = false): Promise<void> {
  if (!req || busy.value) return
  busy.value = true
  errorText.value = ''
  try {
    if (approve) {
      await conn.call('device.approve', { request_id: req.request_id }, 10000)
    } else {
      await conn.call('device.deny', { request_id: req.request_id, block }, 10000)
    }
    close()
    clearPairRequest(req.request_id)
  } catch (err) {
    errorText.value = (approve ? '同意失败' : '拒绝失败') + (err instanceof Error ? `：${err.message}` : '')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="req" :class="$style.body">
    <span :class="$style.title">设备连接请求</span>
    <p :class="$style.message">
      一台名为「{{ req.name || '未命名设备' }}」的设备想连接这台 Mac，同意后它可以像本机一样使用这台 Mac 上的智能助手。
    </p>
    <p v-if="errorText" :class="$style.error">{{ errorText }}</p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="busy" @click="decide(false, true)">拒绝且不再询问</button>
      <button type="button" class="mx-btn" :disabled="busy" @click="decide(false)">拒绝</button>
      <button type="button" class="mx-btn mx-btn--primary" :disabled="busy" @click="decide(true)">
        <span v-if="busy" class="mx-text-loading">处理中…</span>
        <template v-else>同意</template>
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
  line-height: 1.6;
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
