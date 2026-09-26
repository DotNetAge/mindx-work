<script setup lang="ts">
/**
 * 配对请求确认弹窗（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 蓝本为 ElMessageBox.confirm（标题「手机连接请求」，同意/拒绝）；同意 = daemon 签发
 * 短码并广播 pair_approved（短码弹窗由引擎经通知驱动呈现）；拒绝 = 请求 TTL 内失效。
 * Esc/遮罩关闭 = 暂不处理（蓝本 close 分支语义：请求超时后自动失效），引擎不重复弹。
 */
import { approveChannelRequest, denyChannelRequest, pairRequest } from '../engine'

/** setup 期快照：弹窗打开前引擎已写入待审批请求 */
const req = pairRequest.value
</script>

<template>
  <div v-if="req" :class="$style.body">
    <span :class="$style.title">手机连接请求</span>
    <p :class="$style.message">
      有手机端「{{ req.device_hint || '未知设备' }}」连入，是否同意连接？同意后将生成配对短码。
    </p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="denyChannelRequest()">拒绝</button>
      <button type="button" class="mx-btn mx-btn--primary" @click="approveChannelRequest()">
        同意
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
