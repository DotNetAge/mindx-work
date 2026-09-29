<script setup lang="ts">
/**
 * CalendarView —— 调度任务日历（Content 主工作区视图，移植自 mindx-desktop
 * ScheduleView）。Sidebar 入口为壳行数据模型（行点击由壳 activate 本视图）。
 * 数据通道：schedule.list / schedule.create / schedule.del RPC（daemon 实证）；
 * Agent 清单经 agents.registry 服务（消费侧本地声明形状，插件间禁止 import）；
 * 创建任务绑定当前会话（chatflow.store 的 activeSessionId，daemon 在空会话时
 * 回退到该 Agent 最近活动的会话）。daemon 广播 schedule.job_completed / failed /
 * missed 时本视图可见即重拉，使 last_run_at 与启停状态即时反映到日历。
 * 布局：满高型 Content 页面（flex:1 + min-height:0，容器 dragBand 已让位顶部
 * 48px 拖拽带）；创建表单为组件内 absolute 遮罩，不盖侧栏与红绿灯。
 * 样式：全量 --mx-* 语义 token，随壳主题。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, MxIcon, useService } from '@mindx-work/ui-shell-vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'

// ── 消费侧服务形状声明（插件间禁止 import，本地声明所需最小形状）──────────
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

interface AgentsRegistry {
  list(): Promise<
    Array<{ name: string; role?: string; nick_name?: string; icon?: string; hired?: boolean }>
  >
}

interface ChatflowService {
  readonly store: { readonly activeSessionId: string; readonly currentAgent: string }
}

const daemon = useService<DaemonConnection>('daemon.connection')
const agentsRegistry = useService<AgentsRegistry>('agents.registry')
const chatflow = useService<ChatflowService>('chatflow.store')

// ── 调度条目（daemon ScheduleEntry 实证形状）──
interface ScheduleEntry {
  id: string
  agent: string
  session_id?: string
  project_dir?: string
  content: string
  cron_expr: string
  enabled: boolean
  created_at: string
  updated_at: string
  last_run_at?: string
}

// ── Agent 清单（全量，创建表单与过滤共用；显示 = 昵称主名，缺失回退 name）──
interface AgentItem {
  name: string
  role?: string
  nick_name?: string
}

const agents = ref<AgentItem[]>([])

async function loadAgents(): Promise<void> {
  try {
    const list = await agentsRegistry.list()
    agents.value = (list || []).map((a) => ({ name: a.name, role: a.role, nick_name: a.nick_name }))
  } catch (err) {
    console.warn('[Calendar] Agent 清单加载失败:', err)
  }
}

/** 显示规则：昵称主名，缺失回退 name（role 小字在 select 场景省略） */
function agentDisplayName(name: string): string {
  const hit = agents.value.find((a) => a.name === name)
  return hit?.nick_name || name
}

// ── 已有计划列表 ──
const schedules = ref<ScheduleEntry[]>([])
const loading = ref(false)
const filterAgent = ref('')
const allAgents = computed(() => {
  const set = new Set(schedules.value.map((s) => s.agent))
  return Array.from(set).sort()
})
const filteredSchedules = computed(() => {
  if (!filterAgent.value) return schedules.value
  return schedules.value.filter((s) => s.agent === filterAgent.value)
})

// ── 本地日期串（源组件 toISOString 有 UTC 偏移缺陷，此处按本地时区取 YYYY-MM-DD）──
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── FullCalendar 原生 dblclick（dayCellDidMount 绑定）──
function handleDayCellDidMount(info: { date: Date; el: HTMLElement }) {
  info.el.addEventListener('dblclick', () => {
    openCreateDialog(toLocalDateStr(info.date))
  })
}

// ── 创建任务表单 ──
const dialogVisible = ref(false)
const saving = ref(false)
const dialogDate = ref('')
const CRON_OPTIONS = [
  { label: '不重复', value: '' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每天', value: '0 0 * * *' },
  { label: '每周', value: '0 0 * * 0' },
  { label: '每月', value: '0 0 1 * *' },
  { label: '自定义', value: '__custom__' },
]
const formModel = ref({
  agent: '',
  content: '',
  isRecurring: false,
  cronPreset: '',
  cronCustom: '',
  scheduledAt: '',
  scheduledTime: '09:00',
})

function resetForm() {
  formModel.value = {
    agent: agents.value[0]?.name || chatflow.store.currentAgent || '',
    content: '',
    isRecurring: false,
    cronPreset: '',
    cronCustom: '',
    scheduledAt: dialogDate.value,
    scheduledTime: '09:00',
  }
}

function openCreateDialog(dateStr: string) {
  dialogDate.value = dateStr
  resetForm()
  dialogVisible.value = true
}

function handleDialogClose() {
  dialogVisible.value = false
}

const computedCronExpr = computed(() => {
  if (!formModel.value.isRecurring) return ''
  if (formModel.value.cronPreset === '__custom__') return formModel.value.cronCustom.trim()
  return formModel.value.cronPreset
})

async function handleSubmit() {
  if (!formModel.value.content.trim()) return
  saving.value = true
  try {
    const params: Record<string, unknown> = {
      agent: formModel.value.agent,
      content: formModel.value.content.trim(),
    }

    // 绑定当前活跃会话，使调度任务写入用户正在查看的会话上下文
    if (chatflow.store.activeSessionId) {
      params.session_id = chatflow.store.activeSessionId
    }

    if (formModel.value.isRecurring && computedCronExpr.value) {
      params.cron_expr = computedCronExpr.value
    } else {
      // 单次任务 → 拼接日期时间
      params.scheduled_at = `${dialogDate.value}T${formModel.value.scheduledTime}:00`
    }

    await daemon.call('schedule.create', params)
    dialogVisible.value = false
    await loadSchedules()
  } catch (err) {
    console.error('[Calendar] 创建计划失败:', err)
    ElMessage({ message: '创建计划失败', type: 'error', duration: 2000 })
  } finally {
    saving.value = false
  }
}

// ── 日历事件 ──
const calendarEvents = computed(() => {
  return filteredSchedules.value.map((s) => {
    const hasCron = !!s.cron_expr
    return {
      id: s.id,
      title: `[${agentDisplayName(s.agent)}] ${s.content}`,
      start: hasCron ? s.created_at : s.last_run_at || s.created_at,
      end: s.last_run_at || s.created_at,
      extendedProps: {
        agent: s.agent,
        content: s.content,
        cron: s.cron_expr,
        enabled: s.enabled,
      },
      classNames: s.enabled ? ['cal-event-enabled'] : ['cal-event-disabled'],
      display: 'auto' as const,
    }
  })
})

const calendarOptions = computed(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin],
  initialView: 'dayGridMonth',
  headerToolbar: {
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
  },
  buttonText: { today: '今天', month: '月', week: '周', day: '日', list: '列表' },
  locale: 'zh-cn',
  events: calendarEvents.value,
  height: '100%',
  firstDay: 1,
  slotMinTime: '00:00:00',
  slotMaxTime: '24:00:00',
  allDaySlot: false,
  nowIndicator: true,
  editable: false,
  selectable: false,
  dayMaxEvents: 3,
  eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false } as const,
  noEventsText: '暂无计划',
  moreLinkText: (n: number) => `+${n}`,
  dayCellDidMount: handleDayCellDidMount,
}))

async function loadSchedules() {
  loading.value = true
  try {
    const result = await daemon.call<ScheduleEntry[]>('schedule.list', {})
    schedules.value = result || []
  } catch (err) {
    console.error('[Calendar] 计划列表加载失败:', err)
  } finally {
    loading.value = false
  }
}

async function handleEventClick(info: { event: { id: string } }) {
  const id = info.event.id
  const entry = schedules.value.find((s) => s.id === id)
  if (!entry) return
  try {
    await ElMessageBox.confirm(
      `确定删除计划「${entry.content.slice(0, 30)}」吗？删除后不再触发。`,
      '删除计划',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return // 用户取消
  }
  try {
    await daemon.call('schedule.del', { id })
    ElMessage({ message: '计划已删除', type: 'success', duration: 2000 })
    await loadSchedules()
  } catch (err) {
    console.error('[Calendar] 删除计划失败:', err)
    ElMessage({ message: '删除计划失败', type: 'error', duration: 2000 })
  }
}

// ── daemon 调度任务生命周期广播 → 本视图呈现即重拉 ──
const unsubs: Array<() => void> = []
for (const method of ['schedule.job_completed', 'schedule.job_failed', 'schedule.job_missed']) {
  unsubs.push(
    daemon.onNotification(method, () => {
      if (!dialogVisible.value) void loadSchedules()
    }),
  )
}
onUnmounted(() => {
  for (const unsub of unsubs) unsub()
})

// ── Esc 关创建面板（捕获期，避免穿透到壳）──
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !dialogVisible.value) return
  dialogVisible.value = false
  event.preventDefault()
  event.stopPropagation()
}
window.addEventListener('keydown', onKeydown, true)
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

// 挂载即拉取（Content 单活动视图，激活即挂载）
void loadSchedules()
void loadAgents()

// Agent 清单晚于表单首次打开时，缺省 agent 用当前 Agent 兜底
watch(
  () => agents.value.length,
  (n) => {
    if (n > 0 && !dialogVisible.value && !formModel.value.agent) resetForm()
  },
)
</script>

<template>
  <div class="cal-view">
    <!-- 工具行：计数 + 过滤 + 刷新（视图标题由壳 Toolbar 呈现，不重复画） -->
    <header class="cal-toolbar">
      <span class="cal-count">{{ filteredSchedules.length }} / {{ schedules.length }} 个计划</span>
      <div class="cal-toolbar-right">
        <el-select
          v-model="filterAgent"
          size="small"
          placeholder="全部 Agent"
          clearable
          teleported
          popper-class="calendar-popper"
          class="cal-filter"
        >
          <el-option
            v-for="name in allAgents"
            :key="name"
            :label="agentDisplayName(name)"
            :value="name"
          />
        </el-select>
        <el-button size="small" :loading="loading" @click="loadSchedules">刷新</el-button>
      </div>
    </header>

    <!-- 日历本体 -->
    <div class="cal-body">
      <div class="cal-calendar">
        <FullCalendar :options="calendarOptions" @event-click="handleEventClick" />
      </div>
    </div>

    <!-- 底部提示 -->
    <footer class="cal-footer">
      <span class="cal-tip">双击日期格创建计划；点击计划删除</span>
    </footer>

    <!-- 创建计划面板（组件内遮罩，不盖侧栏与红绿灯） -->
    <div v-if="dialogVisible" class="cal-form-overlay" @click.self="handleDialogClose">
      <div class="cal-form-panel">
        <header class="cal-form-header">
          <h3>创建计划</h3>
          <button class="cal-close-btn" title="关闭" aria-label="关闭创建面板" @click="handleDialogClose">
            <MxIcon name="lucide:x" :size="16" />
          </button>
        </header>
        <div class="cal-form-body">
          <el-form label-position="top" class="cal-form" @submit.prevent="handleSubmit">
            <!-- Agent -->
            <el-form-item label="Agent">
              <el-select v-model="formModel.agent" class="cal-field" teleported popper-class="calendar-popper">
                <el-option
                  v-for="a in agents"
                  :key="a.name"
                  :label="a.nick_name || a.name"
                  :value="a.name"
                />
              </el-select>
            </el-form-item>

            <!-- 日期 -->
            <el-form-item label="日期">
              <el-date-picker
                v-model="dialogDate"
                type="date"
                value-format="YYYY-MM-DD"
                class="cal-field"
                popper-class="calendar-popper"
              />
            </el-form-item>

            <!-- 时间（周期性任务不需要） -->
            <el-form-item v-if="!formModel.isRecurring" label="时间">
              <el-time-picker
                v-model="formModel.scheduledTime"
                format="HH:mm"
                value-format="HH:mm"
                class="cal-field"
                popper-class="calendar-popper"
              />
            </el-form-item>

            <!-- 内容 -->
            <el-form-item label="内容">
              <el-input
                v-model="formModel.content"
                type="textarea"
                :rows="3"
                placeholder="让 Agent 做什么（支持自然语言）"
                class="cal-field"
              />
            </el-form-item>

            <!-- 周期性开关 -->
            <el-form-item>
              <el-checkbox v-model="formModel.isRecurring">周期性执行</el-checkbox>
            </el-form-item>

            <!-- CRON 预设 -->
            <el-form-item v-if="formModel.isRecurring" label="重复规则">
              <el-select v-model="formModel.cronPreset" class="cal-field" teleported popper-class="calendar-popper">
                <el-option v-for="opt in CRON_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <el-input
                v-if="formModel.cronPreset === '__custom__'"
                v-model="formModel.cronCustom"
                placeholder="cron 表达式，如 0 9 * * 1-5"
                class="cal-field"
                style="margin-top: 8px"
              />
            </el-form-item>
          </el-form>
        </div>
        <footer class="cal-form-footer">
          <el-button @click="handleDialogClose">取消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSubmit">创建</el-button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── 视图根：满高型 Content 页面（容器 dragBand 已让位顶部拖拽带）─── */
.cal-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--mx-bg-window);
  position: relative;
  overflow: hidden;
}

/* ─── 工具行 ─── */
.cal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-4);
  border-bottom: 1px solid var(--mx-separator-soft);
  flex-shrink: 0;
}

.cal-count {
  font-size: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-family: var(--mx-font-mono);
  padding: 2px var(--mx-space-1);
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
  border-radius: var(--mx-radius-control);
}

.cal-toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.cal-filter {
  width: 140px;
}

.cal-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--mx-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  transition:
    color var(--mx-duration-fast) var(--mx-ease-standard),
    background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.cal-close-btn:hover {
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 12%, transparent);
}

/* ─── 日历区 ─── */
.cal-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  padding: var(--mx-space-3) var(--mx-space-4) var(--mx-space-1);
}

.cal-calendar {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─── 底部提示 ─── */
.cal-footer {
  flex-shrink: 0;
  padding: var(--mx-space-1) var(--mx-space-4) var(--mx-space-2);
  text-align: center;
}

.cal-tip {
  font-size: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  opacity: 0.7;
}

/* ─── 创建计划面板（组件内 absolute 遮罩）─── */
.cal-form-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mx-mask);
  backdrop-filter: var(--mx-mask-blur);
  border-radius: var(--mx-radius-card);
}

.cal-form-panel {
  width: 480px;
  max-height: 85%;
  display: flex;
  flex-direction: column;
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-window);
  box-shadow: var(--mx-shadow-prominent);
}

.cal-form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mx-space-3) var(--mx-space-4);
  border-bottom: 1px solid var(--mx-separator-soft);
  flex-shrink: 0;
}

.cal-form-header h3 {
  margin: 0;
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.cal-form-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--mx-space-4);
}

.cal-form-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-1);
  padding: var(--mx-space-3) var(--mx-space-4);
  border-top: 1px solid var(--mx-separator-soft);
  flex-shrink: 0;
}

.cal-field {
  width: 100%;
}

/* ─── FullCalendar 主题对齐（全量 --mx-* token，随壳明暗主题）─── */
.cal-calendar :deep(.fc) {
  flex: 1;
  display: flex;
  flex-direction: column;
  --fc-border-color: var(--mx-separator-soft);
  --fc-button-text-color: var(--mx-text);
  --fc-button-bg-color: var(--mx-bg-elevated);
  --fc-button-border-color: var(--mx-separator);
  --fc-button-hover-bg-color: var(--mx-hover);
  --fc-button-hover-border-color: var(--mx-accent);
  --fc-button-active-bg-color: color-mix(in srgb, var(--mx-accent) 15%, transparent);
  --fc-button-active-border-color: var(--mx-accent);
  --fc-today-bg-color: color-mix(in srgb, var(--mx-accent) 8%, transparent);
  --fc-event-bg-color: color-mix(in srgb, var(--mx-accent) 15%, transparent);
  --fc-event-border-color: color-mix(in srgb, var(--mx-accent) 30%, transparent);
  --fc-event-text-color: var(--mx-accent);
  --fc-page-bg-color: transparent;
  --fc-neutral-bg-color: color-mix(in srgb, var(--mx-bg-surface) 60%, transparent);
  --fc-list-event-hover-bg-color: color-mix(in srgb, var(--mx-accent) 6%, transparent);
  --fc-now-indicator-color: var(--mx-danger);
  --fc-highlight-color: color-mix(in srgb, var(--mx-accent) 5%, transparent);
  --fc-more-link-bg-color: transparent;
  --fc-more-link-text-color: var(--mx-text-tertiary);
  font-family: var(--mx-font-family);
  font-size: var(--mx-font-body);
  color: var(--mx-text);
}

.cal-calendar :deep(.fc-header-toolbar) {
  margin-bottom: var(--mx-space-3);
  padding: var(--mx-space-1) var(--mx-space-2);
  background: color-mix(in srgb, var(--mx-bg-surface) 50%, transparent);
  border-radius: var(--mx-radius-card);
  border: 1px solid var(--mx-separator-soft);
}

.cal-calendar :deep(.fc-toolbar-title) {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.cal-calendar :deep(.fc-button) {
  font-size: var(--mx-font-caption);
  font-weight: 500;
  padding: 2px var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  transition: all var(--mx-duration-fast) var(--mx-ease-standard);
  text-transform: none;
  box-shadow: none;
}

.cal-calendar :deep(.fc-button-primary:not(:disabled).fc-button-active),
.cal-calendar :deep(.fc-button-primary:not(:disabled):active) {
  background: color-mix(in srgb, var(--mx-accent) 15%, transparent);
  border-color: var(--mx-accent);
  color: var(--mx-accent);
}

.cal-calendar :deep(.fc-button-primary:disabled) {
  opacity: 0.4;
}

.cal-calendar :deep(.fc-today-button) {
  font-weight: 600;
}

.cal-calendar :deep(.fc-theme-standard .fc-scrollgrid) {
  border: 1px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  overflow: hidden;
}

.cal-calendar :deep(.fc-theme-standard th) {
  padding: var(--mx-space-1) 0;
  font-size: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: color-mix(in srgb, var(--mx-bg-surface) 40%, transparent);
  border-color: var(--mx-separator-soft);
}

.cal-calendar :deep(.fc-theme-standard td) {
  border-color: var(--mx-separator-soft);
}

.cal-calendar :deep(.fc-daygrid-day) {
  transition: background var(--mx-duration-fast) var(--mx-ease-standard);
}

.cal-calendar :deep(.fc-daygrid-day:hover) {
  background: color-mix(in srgb, var(--mx-accent) 4%, transparent);
}

.cal-calendar :deep(.fc-daygrid-day-number) {
  font-size: var(--mx-font-caption);
  font-weight: 600;
  padding: 2px var(--mx-space-1);
  color: var(--mx-text-secondary);
}

.cal-calendar :deep(.fc-day-today .fc-daygrid-day-number) {
  color: var(--mx-accent);
}

.cal-calendar :deep(.fc-day-other .fc-daygrid-day-number) {
  opacity: 0.35;
}

.cal-calendar :deep(.fc-event) {
  border-radius: var(--mx-radius-control);
  padding: 1px 2px;
  font-size: var(--mx-font-micro);
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.cal-calendar :deep(.fc-event:hover) {
  opacity: 0.85;
}

.cal-calendar :deep(.cal-event-disabled) {
  opacity: 0.4;
}

.cal-calendar :deep(.fc-event-title) {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cal-calendar :deep(.fc-daygrid-more-link) {
  font-size: var(--mx-font-micro);
  font-weight: 600;
  color: var(--mx-text-tertiary);
  background: transparent;
  padding: 0 2px;
}

.cal-calendar :deep(.fc-daygrid-more-link:hover) {
  color: var(--mx-accent);
}

.cal-calendar :deep(.fc-timegrid-slot) {
  border-color: var(--mx-separator-soft);
}

.cal-calendar :deep(.fc-timegrid-slot-label) {
  font-size: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  font-family: var(--mx-font-mono);
}

.cal-calendar :deep(.fc-timegrid-axis) {
  color: var(--mx-text-tertiary);
}

.cal-calendar :deep(.fc-timegrid-now-indicator-line) {
  border-color: var(--mx-danger);
  border-width: 1.5px;
}

.cal-calendar :deep(.fc-timegrid-now-indicator-arrow) {
  border-color: var(--mx-danger);
}

.cal-calendar :deep(.fc-list-day-cushion) {
  background: color-mix(in srgb, var(--mx-bg-surface) 30%, transparent);
  padding: var(--mx-space-1) var(--mx-space-2);
}

.cal-calendar :deep(.fc-list-day-text) {
  font-size: var(--mx-font-caption);
  font-weight: 700;
  color: var(--mx-text);
}

.cal-calendar :deep(.fc-list-day-side-text) {
  font-size: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.cal-calendar :deep(.fc-list-event:hover td) {
  background: color-mix(in srgb, var(--mx-accent) 3%, transparent);
}

.cal-calendar :deep(.fc-list-event-title) {
  font-size: var(--mx-font-caption);
  color: var(--mx-text);
}

.cal-calendar :deep(.fc-list-event-time) {
  font-size: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-family: var(--mx-font-mono);
}

.cal-calendar :deep(.fc-list-empty) {
  background: transparent;
  color: var(--mx-text-tertiary);
  font-size: var(--mx-font-body);
  padding: var(--mx-space-5);
}

.cal-calendar :deep(.fc-popover) {
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  box-shadow: var(--mx-shadow-panel);
}

.cal-calendar :deep(.fc-popover-header) {
  background: var(--mx-bg-elevated);
  padding: var(--mx-space-1) var(--mx-space-2);
  font-size: var(--mx-font-caption);
  font-weight: 700;
  color: var(--mx-text);
  border-bottom: 1px solid var(--mx-separator-soft);
}

.cal-calendar :deep(.fc-popover-body) {
  padding: 2px;
}

.cal-calendar :deep(.fc-popover-close) {
  color: var(--mx-text-tertiary);
}

.cal-calendar :deep(.fc-list-event-dot) {
  border-color: var(--mx-accent);
}

/* EP popper 外壳（teleported 出 body，scoped 不命中，落全局类） */
:global(.calendar-popper) {
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  box-shadow: var(--mx-shadow-panel);
}

:global(.calendar-popper .el-select-dropdown__item) {
  color: var(--mx-text);
  font-size: var(--mx-font-caption);
}

:global(.calendar-popper .el-select-dropdown__item.is-hovering),
:global(.calendar-popper .el-select-dropdown__item.is-selected) {
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  color: var(--mx-accent);
}
</style>
