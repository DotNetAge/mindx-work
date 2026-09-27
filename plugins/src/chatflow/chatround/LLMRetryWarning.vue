<script setup lang="ts">
// LLMRetryWarning —— LLM 建流自动重试卡（源：mindx-desktop ChatRound/LLMRetryWarning.vue）。
// 倒计时 + 重试序号 + 退避进度条；work 无 vue-i18n：文案改查证中文字面量
// （zh.json message.llmRetry* 逐一核对）。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

const props = defineProps({
  /** 触发限流的服务商名称 */
  provider: {
    type: String,
    default: ''
  },
  /** 即将进行的重试序号（从 1 开始） */
  attempt: {
    type: Number,
    default: 1
  },
  /** 最大重试次数 */
  maxAttempts: {
    type: Number,
    default: 3
  },
  /** 本次重试前的退避等待时长（纳秒） */
  retryAfterNs: {
    type: Number,
    default: 0
  },
  /** 触发重试的 HTTP 状态码（网络错误为 0） */
  statusCode: {
    type: Number,
    default: 0
  }
})

// ── 倒计时：从退避秒数开始每秒递减，到 0 显示「即将重试」 ──
const remainingSeconds = ref(Math.max(0, Math.ceil(props.retryAfterNs / 1e9)))
let timer: ReturnType<typeof setInterval> | null = null

function startCountdown() {
  stopCountdown()
  remainingSeconds.value = Math.max(0, Math.ceil(props.retryAfterNs / 1e9))
  if (remainingSeconds.value <= 0) return
  timer = setInterval(() => {
    remainingSeconds.value = Math.max(0, remainingSeconds.value - 1)
    if (remainingSeconds.value === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

function stopCountdown() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// 同一轮多次重试时 eventData 原地更新 → attempt/retryAfterNs 变化，重启倒计时
watch(
  () => [props.retryAfterNs, props.attempt],
  () => startCountdown(),
  { immediate: true }
)

onBeforeUnmount(stopCountdown)

const statusText = computed(() =>
  remainingSeconds.value > 0
    ? `将于 ${remainingSeconds.value} 秒后自动重试`
    : '正在自动重试'
)

const attemptText = computed(() =>
  `第 ${props.attempt}/${props.maxAttempts} 次重试`
)
</script>

<template>
  <div class="llm-retry-view">
    <div class="retry-icon">
      <!-- 旋转的限流警示环 -->
      <MxIcon name="lucide:loader-circle" :size="20" class="spin" />
    </div>

    <div class="retry-content">
      <div class="retry-title">由于服务商「{{ provider || '当前服务商' }}」限流，请求失败</div>
      <div class="retry-desc">
        <span>{{ statusText }}</span>
        <span class="dot">·</span>
        <span>{{ attemptText }}</span>
        <span v-if="statusCode > 0" class="dot">·</span>
        <span v-if="statusCode > 0" class="status-code">HTTP {{ statusCode }}</span>
      </div>
    </div>

    <!-- 退避等待进度条 -->
    <div v-if="retryAfterNs > 0" class="retry-progress">
      <div
        class="retry-progress-fill"
        :style="{
          width: `${Math.min(100, (1 - remainingSeconds / Math.ceil(retryAfterNs / 1e9)) * 100)}%`
        }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.llm-retry-view {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3) var(--mx-space-4);
  border-radius: var(--mx-radius-card);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--mx-warning) 8%, transparent),
    color-mix(in srgb, var(--mx-warning) 4%, transparent)
  );
  border: 1px solid color-mix(in srgb, var(--mx-warning) 25%, transparent);
  overflow: hidden;
  animation: retry-slide-in 0.3s ease-out;
}

@keyframes retry-slide-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.retry-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-warning) 15%, transparent);
  color: var(--mx-warning);
  flex-shrink: 0;
}

.retry-icon .spin {
  animation: retry-spin 1.2s linear infinite;
}

@keyframes retry-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.retry-content {
  flex: 1;
  min-width: 0;
}

.retry-title {
  font: var(--mx-font-caption);
  font-weight: 700;
  color: color-mix(in srgb, var(--mx-warning) 75%, var(--mx-text));
}

.retry-desc {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  margin-top: 2px;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.retry-desc .dot {
  color: var(--mx-text-tertiary);
}

.status-code {
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
}

/* 底部退避等待进度条（从左到右收缩，视觉上表达等待剩余量） */
.retry-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 2px;
  background: transparent;
}

.retry-progress-fill {
  height: 100%;
  background: color-mix(in srgb, var(--mx-warning) 45%, transparent);
  transition: width 1s linear;
}
</style>
