<script setup lang="ts">
/**
 * ContextUsageGauge —— 会话上下文用量指示器（输入区工具栏形态）。
 *
 * 需求：原「对话流最后一轮 RoundFooter 的 Context ring」整体前移至 ChatInput
 * 工具栏（ModelSelector 之前），明细由环形+表格改为进度条面板形态：
 * - 触发器：ProgressRing（原视觉平移，显示占用百分比）；
 * - 面板（el-popover，placement top）：
 *   「上下文用量」标题行 + 右侧 58.7K/256K · 22.9%（一位小数去 .0）+ chevron
 *   展开明细（窗口词元/窗口上限/活跃消息/消耗/费用）；进度条颜色沿用原 ring
 *   阈值（绿 <40% / 蓝 <60% / 橙 <80% / 红 ≥80%）；「整理对话」按钮（>100K）
 *   随面板保留，打桩通道不变。
 *
 * 数据源：session.context RPC 投影（store.contextUsage），props 注入（对齐
 * ChatInput 纯 props 哲学与 fixture 回归通道）；无数据不渲染由父层 v-if 控制。
 *
 * 挂起：设计稿中的「额度用量」（时段重置 / 近 7 天）为订阅配额概念，daemon 无
 * 对应 RPC（token.usage.* 全部为月度统计面，见 handler_registry.go），禁止猜测
 * 协议——该分区等数据源就绪后补齐，本期不渲染占位假数据。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import ProgressRing from '../tree/round/ProgressRing.vue'
import { formatCompactNumber } from '../toolViewUtils'
import type { ContextUsageInfo } from '../tree/types/content'

const props = defineProps<{
  /** 会话上下文用量（session.context RPC 投影，props 注入） */
  contextUsage: ContextUsageInfo
}>()

// Popover 显隐
const showPanel = ref(false)

// ring 触发器：整数百分比（原 RoundFooter 同构）
const contextPercent = computed(() => Math.round(props.contextUsage.usage_ratio * 100))
// 面板标题行：一位小数去 .0（设计稿 22.9% 形态）
const contextPercentText = computed(() =>
  `${(props.contextUsage.usage_ratio * 100).toFixed(1).replace(/\.0$/, '')}%`
)

const contextRingColor = computed(() => {
  const r = props.contextUsage.usage_ratio
  if (r >= 0.80) return 'var(--mx-danger)'   // 红 ≥ 80%
  if (r >= 0.60) return 'var(--mx-warning)'  // 橙 ≥ 60%
  if (r >= 0.40) return 'var(--mx-business)' // 蓝 ≥ 40%
  return 'var(--mx-success)'                 // 绿 < 40%
})

// 标题行右侧紧凑数值：58.7K/256K · 22.9%
const usageSummaryText = computed(
  () => `${formatCompactNumber(props.contextUsage.window_tokens)}/${formatCompactNumber(props.contextUsage.max_window_size)} · ${contextPercentText.value}`
)

// ── 明细展开区（原 ring popover 表格行平移） ──

type ContextRow = { label: string; value: string; separator?: boolean }

const detailExpanded = ref(false)

const contextTableRows = computed<ContextRow[]>(() => {
  const u = props.contextUsage
  return [
    { label: '窗口词元', value: u.window_tokens.toLocaleString() },
    { label: '窗口上限', value: u.max_window_size.toLocaleString() },
    { label: '活跃消息', value: u.active_message_count.toLocaleString() },
    { label: '', value: '', separator: true },
    { label: '消耗', value: u.total_actual_tokens.toLocaleString() },
    { label: '费用', value: `¥${u.total_cost.toFixed(2)}` },
  ]
})

/** 整理对话按钮：仅在 Token 量超过 100K 时显示（原 RoundFooter 现役口径） */
const shouldShowCompactBtn = computed(() => props.contextUsage.window_tokens > 100000)

/** 整理对话：desktop 走 session.compact RPC（压缩摘要可达数分钟，超时放宽 15 分钟）。
 * work 无 client 通道——禁止猜测协议，四期接 RPC 后原样恢复，以提示打桩 */
function handleCompact(): void {
  ElMessage.info('上下文整理通道待接入（session.compact RPC 四期接线）')
}
</script>

<template>
  <div class="context-gauge">
    <el-popover v-model:visible="showPanel" trigger="click" placement="top" :width="300" popper-class="context-gauge-popover">
      <template #reference>
        <button type="button" class="gauge-trigger">
          <ProgressRing :percent="contextPercent" :color="contextRingColor" :label="`${contextPercent}%`" />
        </button>
      </template>

      <!-- 进度条面板：标题行 + 进度条 + 可展开明细 + 整理对话 -->
      <div class="panel-body">
        <div class="panel-head" @click="detailExpanded = !detailExpanded">
          <span class="panel-title">上下文用量</span>
          <span class="panel-summary">{{ usageSummaryText }}</span>
          <MxIcon name="lucide:chevron-right" :size="16" class="head-chevron" :class="{ expanded: detailExpanded }" />
        </div>

        <div class="usage-bar-track">
          <div class="usage-bar-fill" :style="{ width: `${Math.min(contextPercent, 100)}%`, background: contextRingColor }" />
        </div>

        <div v-if="detailExpanded" class="panel-detail">
          <template v-for="(row, idx) in contextTableRows" :key="idx">
            <div v-if="row.separator" class="detail-separator" />
            <div v-else class="detail-row">
              <span class="detail-label">{{ row.label }}</span>
              <span class="detail-value">{{ row.value }}</span>
            </div>
          </template>
        </div>

        <button v-if="shouldShowCompactBtn" class="compact-btn" @click="handleCompact">
          <MxIcon name="lucide:file-plus-2" :size="16" />
          整理对话
        </button>
      </div>
    </el-popover>
  </div>
</template>

<style scoped>
.context-gauge {
  display: inline-flex;
  align-items: center;
}

.gauge-trigger {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 var(--mx-space-2);
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease;
}

.gauge-trigger:hover {
  background: color-mix(in srgb, var(--mx-text) 6%, transparent);
}
</style>

<!-- Popover 面板样式（全局，因为 popper 渲染到 body） -->
<style>
.context-gauge-popover.el-popper {
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  padding: var(--mx-space-3);
  box-shadow: var(--mx-shadow-prominent);
}

.context-gauge-popover .panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.context-gauge-popover .panel-head {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  cursor: pointer;
  user-select: none;
}

.context-gauge-popover .panel-title {
  font: var(--mx-font-caption);
  font-weight: 700;
  color: var(--mx-text);
}

.context-gauge-popover .panel-summary {
  margin-left: auto;
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-secondary);
}

.context-gauge-popover .head-chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.context-gauge-popover .head-chevron.expanded {
  transform: rotate(90deg);
}

/* ── 进度条 ── */
.context-gauge-popover .usage-bar-track {
  height: 6px;
  border-radius: 3px;
  background: var(--mx-separator);
  overflow: hidden;
}

.context-gauge-popover .usage-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* ── 明细展开区 ── */
.context-gauge-popover .panel-detail {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.context-gauge-popover .detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mx-space-1) 0;
}

.context-gauge-popover .detail-label {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.context-gauge-popover .detail-value {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  font-weight: 600;
  color: var(--mx-text);
}

.context-gauge-popover .detail-separator {
  height: 1px;
  margin: var(--mx-space-1) 0;
  background: var(--mx-separator);
}

/* ── 整理对话（中性，军规 14：同屏单 Primary） ── */
.context-gauge-popover .compact-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-2);
  width: 100%;
  margin-top: var(--mx-space-1);
  padding: var(--mx-space-2) var(--mx-space-3);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 80%, transparent);
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-secondary);
  font: var(--mx-font-caption);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.context-gauge-popover .compact-btn:hover {
  background: color-mix(in srgb, var(--mx-text) 5%, transparent);
  border-color: var(--mx-separator);
  color: var(--mx-text);
}
</style>
