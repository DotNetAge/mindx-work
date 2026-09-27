<script setup lang="ts">
// MaxTurnsWarning —— 达到最大轮次卡（源：mindx-desktop ChatRound/MaxTurnsWarning.vue）。
// 进度环 + 三列明细 + 建议块；work 无 vue-i18n：建议标签改查证中文字面量
// （zh.json maxTurnsView.suggestion，desktop 原样将其渲染在建议块头部）。
import { computed } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

const props = defineProps({
  turnsCompleted: {
    type: Number,
    default: 0
  },
  maxTurns: {
    type: Number,
    default: 10
  },
  suggestion: {
    type: String,
    default: ''
  }
})

const progressPercent = computed(() => {
  if (props.maxTurns <= 0) return 100
  return Math.min(100, Math.round((props.turnsCompleted / props.maxTurns) * 100))
})

const isOverLimit = computed(() => props.turnsCompleted >= props.maxTurns)

function getProgressColor() {
  const pct = progressPercent.value
  if (pct >= 100) return 'var(--mx-warning)'
  if (pct >= 80) return 'color-mix(in srgb, var(--mx-warning) 70%, var(--mx-static-white))'
  return 'color-mix(in srgb, var(--mx-warning) 50%, var(--mx-static-white))'
}
</script>

<template>
  <div class="max-turns-view">
    <div class="warning-header">
      <div class="warning-icon">
        <MxIcon name="lucide:triangle-alert" :size="20" />
      </div>

      <div class="warning-content">
        <h4 class="warning-title">达到最大轮次</h4>
        <p class="warning-desc">
          对话已达到预设的最大交互轮次限制
        </p>
      </div>

      <div class="turns-indicator">
        <svg class="progress-ring" width="52" height="52" viewBox="0 0 52 52">
          <circle
            class="progress-ring-bg"
            cx="26"
            cy="26"
            r="22"
            fill="none"
            stroke-width="4"
          />
          <circle
            class="progress-ring-fill"
            cx="26"
            cy="26"
            r="22"
            fill="none"
            stroke-width="4"
            :stroke-dasharray="138.23"
            :stroke-dashoffset="138.23 * (1 - progressPercent / 100)"
            :style="{ stroke: getProgressColor() }"
          />
        </svg>
        <div class="turns-label">
          <span class="turns-current">{{ turnsCompleted }}</span>
          <span class="turns-separator">/</span>
          <span class="turns-max">{{ maxTurns }}</span>
        </div>
      </div>
    </div>

    <div class="turns-detail">
      <div class="detail-row">
        <span class="detail-key">已完成轮次</span>
        <span class="detail-value turns-value">{{ turnsCompleted }}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">上限</span>
        <span class="detail-value limit-value">{{ maxTurns }}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">状态</span>
        <span class="detail-value status-badge" :class="{ over: isOverLimit }">
          {{ isOverLimit ? '已达上限' : '接近上限' }}
        </span>
      </div>
    </div>

    <div class="suggestion-block" v-if="suggestion">
      <div class="suggestion-header">
        <MxIcon name="lucide:lightbulb" :size="16" />
        <span>你可以发送 "继续" 让 AI 继续处理当前任务。</span>
      </div>
      <p class="suggestion-text">{{ suggestion }}</p>
    </div>
  </div>
</template>

<style scoped>
.max-turns-view {
  background: linear-gradient(135deg, color-mix(in srgb, var(--mx-warning) 7%, transparent), color-mix(in srgb, var(--mx-warning) 4%, transparent));
  border: 1px solid color-mix(in srgb, var(--mx-warning) 25%, transparent);
  border-radius: var(--mx-radius-window);
  overflow: hidden;
  box-shadow: 0 8px 32px color-mix(in srgb, var(--mx-warning) 8%, transparent);
  animation: slide-in 0.35s ease-out;
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.warning-header {
  display: flex;
  align-items: flex-start;
  gap: var(--mx-space-4);
  padding: var(--mx-space-4) var(--mx-space-6);
  background: color-mix(in srgb, var(--mx-warning) 4%, transparent);
}

.warning-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--mx-radius-card);
  background: linear-gradient(135deg, var(--mx-warning), color-mix(in srgb, var(--mx-warning) 60%, black));
  color: var(--mx-static-white);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--mx-warning) 25%, transparent);
}

.warning-content {
  flex: 1;
  min-width: 0;
}

.warning-title {
  font: var(--mx-font-body);
  font-weight: 700;
  color: color-mix(in srgb, var(--mx-warning) 70%, var(--mx-static-white));
  letter-spacing: -0.3px;
  margin-bottom: var(--mx-space-1);
}

.warning-desc {
  font: var(--mx-font-body);
  line-height: 1.6;
  color: var(--mx-text-secondary);
  margin: 0;
}

.turns-indicator {
  position: relative;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-ring {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}

.progress-ring-bg {
  stroke: color-mix(in srgb, var(--mx-warning) 15%, transparent);
}

.progress-ring-fill {
  stroke-linecap: round;
  transition: stroke-dashoffset 0.6s ease, stroke 0.3s ease;
}

.turns-label {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-1);
  font-family: var(--mx-font-mono);
}

.turns-current {
  font: var(--mx-font-body);
  font-weight: 700;
  color: color-mix(in srgb, var(--mx-warning) 70%, var(--mx-static-white));
}

.turns-separator {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.turns-max {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-tertiary);
}

.turns-detail {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--mx-space-1);
  padding: 0 var(--mx-space-6);
  margin-top: var(--mx-space-4);
  background: color-mix(in srgb, var(--mx-warning) 10%, transparent);
}

.detail-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mx-space-1);
  padding: var(--mx-space-3) var(--mx-space-2);
  background: var(--mx-bg-elevated);
}

.detail-key {
  font: var(--mx-font-caption);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--mx-text-tertiary);
}

.detail-value {
  font: var(--mx-font-heading);
  font-family: var(--mx-font-mono);
}

.turns-value {
  color: color-mix(in srgb, var(--mx-warning) 70%, var(--mx-static-white));
}

.limit-value {
  color: var(--mx-text-secondary);
}

.status-badge {
  font: var(--mx-font-caption);
  font-weight: 600;
  padding: 3px var(--mx-space-3);
  border-radius: var(--mx-radius-window);
  background: color-mix(in srgb, var(--mx-warning) 15%, transparent);
  color: color-mix(in srgb, var(--mx-warning) 50%, var(--mx-static-white));
  border: 1px solid color-mix(in srgb, var(--mx-warning) 25%, transparent);
}

.status-badge.over {
  background: color-mix(in srgb, var(--mx-warning) 20%, transparent);
  color: color-mix(in srgb, var(--mx-warning) 70%, var(--mx-static-white));
  border-color: color-mix(in srgb, var(--mx-warning) 35%, transparent);
}

.suggestion-block {
  margin: var(--mx-space-4) var(--mx-space-6) var(--mx-space-4);
  padding: var(--mx-space-4) var(--mx-space-4);
  background: linear-gradient(135deg, color-mix(in srgb, var(--mx-warning) 8%, transparent), color-mix(in srgb, var(--mx-warning) 5%, transparent));
  border: 1px solid color-mix(in srgb, var(--mx-warning) 18%, transparent);
  border-radius: var(--mx-radius-card);
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
  color: color-mix(in srgb, var(--mx-warning) 50%, var(--mx-static-white));
  font: var(--mx-font-caption);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.suggestion-text {
  font: var(--mx-font-body);
  line-height: 1.7;
  color: var(--mx-text-secondary);
  margin: 0;
  word-break: break-word;
}
</style>
