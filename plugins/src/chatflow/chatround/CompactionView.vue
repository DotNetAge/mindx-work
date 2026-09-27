<script setup lang="ts">
// CompactionView —— 上下文压缩卡（源：mindx-desktop ChatRound/CompactionView.vue）。
// 窗口占用条 + 占用率；session tag 在树节点用法恒为空（CompactionNodeView 传 ''）。
import { computed } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

const props = defineProps({
  sessionID: {
    type: String,
    default: ''
  },
  remainingAfter: {
    type: Number,
    default: 0
  },
  windowSize: {
    type: Number,
    default: 0
  }
})

const usageRatio = computed(() => {
  if (!props.windowSize) return 0
  return Math.min((props.remainingAfter / props.windowSize) * 100, 100)
})

const usagePercent = computed(() => usageRatio.value.toFixed(1))

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}
</script>

<template>
  <div class="compaction-view">
    <div class="compaction-header">
      <div class="header-left">
        <div class="compaction-icon">
          <MxIcon name="lucide:briefcase" :size="16" />
        </div>
        <h3 class="compaction-title">上下文压缩</h3>
      </div>

      <div class="header-right">
        <el-tooltip v-if="sessionID" :content="sessionID" placement="top">
          <span class="session-tag">{{ sessionID.slice(0, 8) }}</span>
        </el-tooltip>
      </div>
    </div>

    <div class="compaction-body">
      <div class="window-bar-section">
        <div class="bar-labels">
          <span class="bar-label">上下文窗口</span>
          <span class="bar-value">{{ formatNumber(remainingAfter) }} / {{ formatNumber(windowSize) }}</span>
        </div>
        <div class="window-bar-track">
          <div
            class="window-bar-fill"
            :style="{ width: `${usageRatio}%` }"
          ></div>
          <div
            class="window-bar-glow"
            :style="{ width: `${usageRatio}%` }"
          ></div>
        </div>
        <div class="bar-footer">
          <span class="usage-text">占用率</span>
          <span class="usage-percent">{{ usagePercent }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compaction-view {
  background: linear-gradient(135deg, color-mix(in srgb, var(--mx-accent) 6%, transparent), color-mix(in srgb, var(--mx-accent) 4%, transparent));
  border: 1px solid color-mix(in srgb, var(--mx-accent) 20%, transparent);
  border-radius: var(--mx-radius-card);
  overflow: hidden;
  animation: compaction-enter 0.35s ease-out;
}

@keyframes compaction-enter {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.compaction-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mx-space-3) var(--mx-space-4);
  border-bottom: 1px solid color-mix(in srgb, var(--mx-accent) 12%, transparent);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
}

.compaction-icon {
  width: 30px;
  height: 30px;
  border-radius: var(--mx-radius-control);
  background: linear-gradient(135deg, var(--mx-accent), color-mix(in srgb, var(--mx-accent) 55%, black));
  color: var(--mx-static-white);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.compaction-title {
  font: var(--mx-font-body);
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--mx-text);
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.session-tag {
  font: var(--mx-font-micro);
  font-family: var(--mx-font-mono);
  font-weight: 600;
  padding: 3px var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
  color: color-mix(in srgb, var(--mx-accent) 70%, var(--mx-static-white));
  border: 1px solid color-mix(in srgb, var(--mx-accent) 20%, transparent);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compaction-body {
  padding: var(--mx-space-4) var(--mx-space-4) var(--mx-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
}

.window-bar-section {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.bar-labels {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bar-label {
  font: var(--mx-font-caption);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--mx-text-tertiary);
}

.bar-value {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  font-weight: 600;
  color: color-mix(in srgb, var(--mx-accent) 70%, var(--mx-static-white));
}

.window-bar-track {
  position: relative;
  height: 8px;
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  border-radius: var(--mx-radius-control);
  overflow: hidden;
}

.window-bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, var(--mx-accent), color-mix(in srgb, var(--mx-accent) 55%, black));
  border-radius: var(--mx-radius-control);
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.window-bar-glow {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, var(--mx-accent), color-mix(in srgb, var(--mx-accent) 55%, black));
  border-radius: var(--mx-radius-control);
  filter: blur(4px);
  opacity: 0.4;
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.bar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.usage-text {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
}

.usage-percent {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  font-weight: 700;
  color: var(--mx-accent);
}
</style>
