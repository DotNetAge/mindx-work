<script setup lang="ts">
/**
 * UsageView — Token 用量仪表板（Content 满高页，移植自 mindx-desktop TokenUsageReport）。
 * 数据经 daemon.connection：月度汇总 token.usage.monthly {year, month}，
 * 当前会话明细 token.usage.session.detail {session_id}（方法名经 handler_registry.go 实证）。
 * 会话 id 消费 chatflow.store 延迟外壳（服务契约，禁止跨插件 import）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElTooltip, MxIcon, useService } from '@mindx-work/ui-shell-vue'

/** daemon.connection 最小消费形状（服务契约） */
interface ConnectionService {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** chatflow.store 延迟外壳最小消费形状（.store.activeSessionId） */
interface ChatflowService {
  store: { activeSessionId?: string }
}

/** RPC 返回形状（对齐 daemon buildMonthlyStats 实测：daily_usage/model_breakdown 条目均为 input_tokens/output_tokens） */
interface DailyUsage {
  date: string
  input_tokens: number
  output_tokens: number
  cached_tokens?: number
  total_tokens: number
  cost: number
  request_count: number
  model: string
}
interface ModelUsageSummary {
  model: string
  provider: string
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cached_tokens?: number
  total_cost: number
  request_count: number
  avg_tokens_per_request: number
}
interface MonthlyUsageStats {
  year: number
  month: number
  total_cost: number
  total_tokens: number
  total_requests: number
  daily_usage: DailyUsage[]
  model_breakdown: ModelUsageSummary[]
}
interface SessionTokenDetailRecord {
  timestamp: string
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  total_tokens: number
  cost: number
  model_name: string
  provider_name: string
}

const daemon = useService<ConnectionService>('daemon.connection')
const chatflow = useService<ChatflowService>('chatflow.store')

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth() + 1)

const monthly = ref<MonthlyUsageStats | null>(null)
const monthlyLoading = ref(false)
const monthlyError = ref('')

const records = ref<SessionTokenDetailRecord[]>([])
const sessionLoading = ref(false)
const sessionError = ref('')

const monthLabel = computed(() => `${year.value}-${String(month.value).padStart(2, '0')}`)

function shiftMonth(delta: number): void {
  const d = new Date(year.value, month.value - 1 + delta, 1)
  year.value = d.getFullYear()
  month.value = d.getMonth() + 1
}

function goCurrentMonth(): void {
  year.value = now.getFullYear()
  month.value = now.getMonth() + 1
}

async function loadMonthly(): Promise<void> {
  monthlyLoading.value = true
  monthlyError.value = ''
  try {
    monthly.value = await daemon.call<MonthlyUsageStats>('token.usage.monthly', {
      year: year.value,
      month: month.value,
    })
  } catch (e) {
    monthly.value = null
    monthlyError.value = e instanceof Error ? e.message : String(e)
  } finally {
    monthlyLoading.value = false
  }
}

async function loadSessionDetail(sessionId: string): Promise<void> {
  sessionLoading.value = true
  sessionError.value = ''
  try {
    const res = await daemon.call<{ session_id: string; records: SessionTokenDetailRecord[] }>(
      'token.usage.session.detail',
      { session_id: sessionId },
    )
    records.value = res?.records ?? []
  } catch (e) {
    records.value = []
    sessionError.value = e instanceof Error ? e.message : String(e)
  } finally {
    sessionLoading.value = false
  }
}

onMounted(() => {
  void loadMonthly()
})

watch([year, month], () => {
  void loadMonthly()
})

// 会话明细跟随 chatflow 当前会话（切会话即重拉）
const activeSessionId = computed(() => chatflow?.store?.activeSessionId ?? '')
watch(
  activeSessionId,
  (id) => {
    if (id) void loadSessionDetail(id)
    else records.value = []
  },
  { immediate: true },
)

// ── 展示推导 ──────────────────────────────────────────────────────────────

function formatCost(v: number): string {
  return `¥${v.toFixed(2)}`
}

function formatCount(v: number): string {
  return v.toLocaleString('zh-CN')
}

/** 本地时区手拼日期时间（军规：禁 toISOString().slice，UTC 偏移缺陷） */
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 每日条形：cost 归一化高度（4–120px） */
const dailyBars = computed(() => {
  const list = monthly.value?.daily_usage ?? []
  let max = 0
  for (const d of list) if (d.cost > max) max = d.cost
  return list.map((d) => ({
    ...d,
    height: max > 0 ? Math.max(4, Math.round((d.cost / max) * 120)) : 4,
    tip: `${d.date} · ${formatCost(d.cost)} · ${formatCount(d.request_count)} 请求 · ${formatCount(d.total_tokens)} tokens`,
  }))
})

const modelRows = computed(() => monthly.value?.model_breakdown ?? [])

const summaryCards = computed(() => {
  const m = monthly.value
  return [
    { label: '总费用', value: m ? formatCost(m.total_cost) : '—' },
    { label: '总 Tokens', value: m ? formatCount(m.total_tokens) : '—' },
    { label: '总请求', value: m ? formatCount(m.total_requests) : '—' },
  ]
})

/** 当前会话明细合计 */
const sessionTotal = computed(() => {
  let total = 0
  let cost = 0
  for (const r of records.value) {
    total += r.total_tokens
    cost += r.cost
  }
  return { total, cost }
})
</script>

<template>
  <div class="usage-view">
    <!-- 工具行：月份切换 -->
    <div class="toolbar">
      <div class="month-nav">
        <button type="button" class="mx-icon-btn" aria-label="上一月" @click="shiftMonth(-1)">
          <MxIcon name="lucide:chevron-left" :size="16" />
        </button>
        <span class="month-label">{{ monthLabel }}</span>
        <button type="button" class="mx-icon-btn" aria-label="下一月" @click="shiftMonth(1)">
          <MxIcon name="lucide:chevron-right" :size="16" />
        </button>
      </div>
      <button type="button" class="back-now" @click="goCurrentMonth">回到本月</button>
    </div>

    <!-- 月度汇总加载/错误态 -->
    <div v-if="monthlyLoading" class="state">加载中…</div>
    <div v-else-if="monthlyError" class="state error">加载失败：{{ monthlyError }}</div>

    <template v-else>
      <!-- 汇总卡 -->
      <div class="cards">
        <div v-for="card in summaryCards" :key="card.label" class="card">
          <div class="card-label">{{ card.label }}</div>
          <div class="card-value">{{ card.value }}</div>
        </div>
      </div>

      <!-- 每日费用条形图 -->
      <section class="card section">
        <h3 class="section-title">每日费用</h3>
        <div v-if="!dailyBars.length" class="empty">本月暂无数据</div>
        <div v-else class="bars">
          <ElTooltip v-for="bar in dailyBars" :key="bar.date" :content="bar.tip" placement="top">
            <div class="bar" :style="{ height: `${bar.height}px` }" />
          </ElTooltip>
        </div>
      </section>

      <!-- 按模型分组 -->
      <section class="card section">
        <h3 class="section-title">按模型</h3>
        <div v-if="!modelRows.length" class="empty">本月暂无数据</div>
        <table v-else class="grid">
          <thead>
            <tr>
              <th>模型</th>
              <th>提供商</th>
              <th class="num">请求</th>
              <th class="num">输入</th>
              <th class="num">输出</th>
              <th class="num">合计 Tokens</th>
              <th class="num">费用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in modelRows" :key="row.model">
              <td class="mono">{{ row.model }}</td>
              <td>{{ row.provider }}</td>
              <td class="num mono">{{ formatCount(row.request_count) }}</td>
              <td class="num mono">{{ formatCount(row.input_tokens) }}</td>
              <td class="num mono">{{ formatCount(row.output_tokens) }}</td>
              <td class="num mono">{{ formatCount(row.total_tokens) }}</td>
              <td class="num mono">{{ formatCost(row.total_cost) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- 当前会话明细 -->
    <section class="card section">
      <h3 class="section-title">
        当前会话明细
        <span v-if="records.length" class="section-meta">
          {{ formatCount(sessionTotal.total) }} tokens · {{ formatCost(sessionTotal.cost) }}
        </span>
      </h3>
      <div v-if="sessionLoading" class="state">加载中…</div>
      <div v-else-if="sessionError" class="state error">加载失败：{{ sessionError }}</div>
      <div v-else-if="!activeSessionId" class="empty">当前没有打开的会话</div>
      <div v-else-if="!records.length" class="empty">当前会话暂无用量记录</div>
      <table v-else class="grid">
        <thead>
          <tr>
            <th>时间</th>
            <th class="num">输入</th>
            <th class="num">输出</th>
            <th class="num">缓存</th>
            <th class="num">合计</th>
            <th class="num">费用</th>
            <th>模型</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in records" :key="`${r.timestamp}-${i}`">
            <td class="mono">{{ formatTime(r.timestamp) }}</td>
            <td class="num mono">{{ formatCount(r.input_tokens) }}</td>
            <td class="num mono">{{ formatCount(r.output_tokens) }}</td>
            <td class="num mono">{{ formatCount(r.cached_tokens) }}</td>
            <td class="num mono">{{ formatCount(r.total_tokens) }}</td>
            <td class="num mono">{{ formatCost(r.cost) }}</td>
            <td class="mono">{{ r.model_name }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
/* 满高页面根：Content 壳位（dragBand 已让位顶部 48px） */
.usage-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  padding: var(--mx-space-4);
  overflow-y: auto;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.month-nav {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.month-label {
  min-width: 72px;
  text-align: center;
  font: var(--mx-font-heading);
  color: var(--mx-text);
  font-variant-numeric: tabular-nums;
}

.back-now {
  border: none;
  background: transparent;
  color: var(--mx-text-tertiary);
  font: var(--mx-font-caption);
  cursor: pointer;
  padding: var(--mx-space-1) var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  transition: background var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.back-now:hover {
  background: var(--mx-bg-surface);
  color: var(--mx-text);
}

.back-now:focus-visible {
  outline: 1px solid var(--mx-accent);
  outline-offset: -1px;
}

.card {
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  padding: var(--mx-space-4);
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--mx-space-3);
}

.card-label {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 汇总卡数值：KPI 数字 30px（heading 15px 的 2 倍，用户定稿），字阶特例 */
.card-value {
  margin-top: var(--mx-space-1);
  font-size: 30px;
  line-height: 1.2;
  font-weight: 600;
  color: var(--mx-text);
  font-variant-numeric: tabular-nums;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.section-title {
  margin: 0;
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.section-meta {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 每日条形图：等宽列 + 尾部对齐 */
.bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-height: 124px;
  padding-top: var(--mx-space-2);
}

.bar {
  flex: 1;
  min-width: 6px;
  /* 顶部小圆角（三档中 control 档），底部贴合基线保持平直 */
  border-radius: var(--mx-radius-control) var(--mx-radius-control) 0 0;
  background: color-mix(in srgb, var(--mx-accent) 70%, transparent);
  cursor: default;
  transition: background var(--mx-duration-fast) var(--mx-ease-standard),
    height var(--mx-duration-motion) var(--mx-ease-standard);
}

.bar:hover {
  background: var(--mx-accent);
}

.grid {
  width: 100%;
  border-collapse: collapse;
}

.grid th {
  text-align: left;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-1) var(--mx-space-2);
  border-bottom: 1px solid var(--mx-separator-soft);
  white-space: nowrap;
}

.grid td {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  padding: var(--mx-space-2);
  border-bottom: 1px solid var(--mx-separator-soft);
  white-space: nowrap;
}

.grid tbody tr {
  transition: background var(--mx-duration-fast) var(--mx-ease-standard);
}

.grid tbody tr:hover {
  background: var(--mx-bg-surface);
}

.grid .num {
  text-align: right;
}

.mono {
  font-family: var(--mx-font-mono);
  font-variant-numeric: tabular-nums;
}

.state {
  font: var(--mx-font-body);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-4);
}

.state.error {
  color: var(--mx-danger);
}

.empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}

@media (prefers-reduced-motion: reduce) {
  .bar,
  .grid tbody tr,
  .back-now {
    transition: none;
  }
}
</style>
