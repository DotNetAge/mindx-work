<script setup lang="ts">
// RoundFooter —— 轮根渲染层之轮 footer（PR §3.6 / §4.3）。
//
// 二期 A 范围（纯 props 数据渲染）：
// - 文件变更摘要：由轮内 write/edit 节点 resultMeta 的 ±行数聚合（取舍 16，
//   不聚合 pending diff——父组件从树提取后以纯数据传入，本组件不认识节点树）；
// - 用量统计行：tokensIn/Out/Cache/实耗（扣缓存）/调用次数/成本/时长。
//
// 变更记录：原「Context ring（ProgressRing + Popover 明细 + 整理对话，仅最后一轮
// 渲染）」已按需求前移至输入区工具栏（input/ContextUsageGauge.vue），本组件不再
// 承载上下文用量展示。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import LangBadge from '../nodes/shared/LangBadge.vue'
import { basename, formatCompactNumber, formatDuration, tryOpenFile } from '../../toolViewUtils'
import { useChatflowStore } from '../../store'
import type { TurnUsage } from '../types/content'

/** 轮内文件变更（父组件从 write/edit 节点 resultMeta 聚合，纯数据） */
interface RoundFileChange {
  path: string
  additions: number
  deletions: number
}

const props = defineProps<{
  fileChanges: RoundFileChange[]
  usage: TurnUsage | null
  /** 轮总时长（轮内消息时间跨度，§3.5 轮层） */
  roundDurationMs?: number
}>()

// ── 文件变更卡片（取舍 16：聚合 write/edit resultMeta，不聚合 pending diff） ──
// 形态：头行（图标 + 计数 + 聚合 ± 行数 + 折叠 chevron）+ 每文件明细行，头行点击切换折叠

const detailExpanded = ref(false)

const changeAdd = computed(() => props.fileChanges.reduce((s, f) => s + f.additions, 0))
const changeDel = computed(() => props.fileChanges.reduce((s, f) => s + f.deletions, 0))

/** 变更卡文件行点击：跳转 Details「变更」面板定位该文件（diffFocusPath 通道）；
 *  变更面板未注册（插件停用）时降级原文件打开行为 */
const shell = useShell()
const chatStore = useChatflowStore()

function openRowDiff(path: string): void {
  if (shell.Detail.entries.some((e) => e.id === 'diff-detail')) {
    chatStore.diffFocusPath = path
    shell.Detail.show('diff-detail')
    return
  }
  void tryOpenFile(path)
}

// ── 用量统计行（数据源 = 轮跨度聚合的 turnUsage，由父组件传入） ───────────

const hasUsage = computed(() => !!props.usage && (props.usage.promptTokens > 0 || props.usage.completionTokens > 0))

/** 用量行点击：desktop 打开设置用量报告（openSettingsEditor('token')）；
 * work 设置页跳转通道四期接线，二期 A 占位提示 */
function openUsageReport(): void {
  ElMessage.info('用量报告通道待接入')
}

/** footer 是否有可渲染内容：两段全空不渲染（避免每轮出现空工具带） */
const hasContent = computed(() => props.fileChanges.length > 0 || hasUsage.value)
</script>

<template>
  <div v-if="hasContent" class="round-footer">
    <!-- 文件变更卡片：头行（图标 + 计数 + 聚合 ± + 折叠 chevron）+ 每文件明细 -->
    <div v-if="fileChanges.length" class="change-card">
      <!-- 头行点击切换明细折叠；右侧 chevron 指示折叠态 -->
      <div class="change-head" @click="detailExpanded = !detailExpanded">
        <MxIcon name="lucide:file-text" :size="16" class="change-icon" />
        <span class="change-title">{{ fileChanges.length }} 个文件已更改</span>
        <span class="flex-spacer" />
        <!-- ± 全 0（历史轮无 result_meta 统计）时不显示 -->
        <template v-if="changeAdd || changeDel">
          <span class="stat-add">+{{ changeAdd }}</span>
          <span class="stat-del">-{{ changeDel }}</span>
        </template>
        <MxIcon name="lucide:chevron-right" :size="16" class="change-chevron" :class="{ expanded: detailExpanded }" />
      </div>
      <div v-if="detailExpanded" class="change-rows">
        <!-- 点击文件行：四期接 vscode.diff 对照查看（二期 A 占位打开） -->
        <div v-for="f in fileChanges" :key="f.path" class="change-row clickable" @click="openRowDiff(f.path)">
          <LangBadge :path="f.path" size="sm" />
          <span class="row-name">{{ basename(f.path) || f.path }}</span>
          <span class="row-path">{{ f.path }}</span>
          <span class="flex-spacer" />
          <template v-if="f.additions || f.deletions">
            <span class="stat-add">+{{ f.additions }}</span>
            <span class="stat-del">-{{ f.deletions }}</span>
          </template>
        </div>
      </div>
    </div>

    <!-- 用量统计行：整行点击打开用量报告（四期接线，二期 A 占位提示） -->
    <el-tooltip content="查看用量报告" placement="top" :hide-after="0">
      <div
        v-if="hasUsage"
        class="usage-row"
        @click="openUsageReport"
      >
        <span class="usage-item">词元输入 {{ formatCompactNumber(usage!.promptTokens) }}</span>
        <span class="usage-item">词元输出 {{ formatCompactNumber(usage!.completionTokens) }}</span>
        <span class="usage-item">缓存 {{ formatCompactNumber(usage!.cachedTokens) }}</span>
        <span class="usage-item">总计 {{ formatCompactNumber(usage!.actualTokens) }}</span>
        <span v-if="usage!.callCount" class="usage-item">调用 {{ usage!.callCount }} 次</span>
        <span v-if="usage!.cost" class="usage-item">费用 ¥{{ usage!.cost.toFixed(2) }}</span>
        <span v-if="roundDurationMs" class="usage-item">{{ formatDuration(roundDurationMs) }}</span>
      </div>
    </el-tooltip>
  </div>
</template>

<style scoped>
.round-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mx-space-3);
  padding-top: var(--mx-space-2);
  border-top: 1px solid color-mix(in srgb, var(--mx-accent) 10%, transparent);
  font: var(--mx-font-micro);
}

/* ── 文件变更卡片 ── */
.change-card {
  flex: 1 1 100%;
  min-width: 0;
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  overflow: hidden;
}

.change-head {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  cursor: pointer;
  user-select: none;
}

.change-icon {
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.change-title {
  color: var(--mx-text);
}

.change-chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s ease, color 0.15s;
  flex-shrink: 0;
}

.change-chevron.expanded {
  transform: rotate(90deg);
}

.change-head:hover .change-chevron {
  color: var(--mx-text);
}

.stat-add {
  font-family: var(--mx-font-mono);
  color: var(--mx-success);
}

.stat-del {
  font-family: var(--mx-font-mono);
  color: var(--mx-danger);
}

.change-rows {
  border-top: 1px solid var(--mx-separator);
  padding: var(--mx-space-1) 0;
}

.change-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) var(--mx-space-3);
  font: var(--mx-font-micro);
  min-width: 0;
}

.change-row.clickable {
  cursor: pointer;
}

.change-row:hover .row-name {
  color: var(--mx-accent);
}

.row-name {
  color: var(--mx-text);
  flex-shrink: 0;
}

.row-path {
  color: var(--mx-text-tertiary);
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 用量统计行 ── */
.usage-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mx-space-2);
  cursor: pointer;
  border-radius: var(--mx-radius-control);
  padding: 2px var(--mx-space-1);
  margin: -2px calc(-1 * var(--mx-space-1));
  transition: background 0.15s ease;
}

.usage-row:hover .usage-item {
  color: var(--mx-accent);
}

.usage-item {
  font: var(--mx-font-micro);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
}

.flex-spacer {
  flex: 1;
  min-width: 0;
}
</style>
