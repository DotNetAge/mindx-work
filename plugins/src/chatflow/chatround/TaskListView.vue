<script lang="ts">
// TaskItem —— 任务看板条目类型（desktop chatStore.TaskItem 字段逐一投影）。
export interface TaskItem {
  id: string
  subject: string
  description?: string
  status: string // 'pending' | 'in_progress' | 'completed' | 'cancelled'
  owner?: string
  activeForm?: string
  blockedBy?: string[]
  blocks?: string[]
  metadata?: Record<string, unknown>
  createdAt?: string
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

/**
 * TaskListView — TaskXXX 工具系列的持久 Todo List 视图（desktop 原样平移，二期 B）。
 *
 * desktop 有双形态：浮窗模式（右侧浮窗，头部拖拽停靠 + 手动关闭 + 全部完成自动关闭）
 * 与嵌入模式（embedded，嵌入对话流轮内，默认折叠为一行）。work 的席位只有树内
 * 嵌入形态（tool.task_query 展开态，只读看板）——浮窗三能力依赖会话级可写看板
 * store（chatStore.tasksBySession），work 数据层四期才接，故本期只平移嵌入只读
 * 形态，数据经 props 注入（对齐 ChatRound 容器的 store 依赖改 props 注入模式）；
 * 浮窗能力随四期数据层评估是否登记席位，不预设。
 *
 * 嵌入形态：
 * - 默认折叠为一行头（图标 + 标题 + 进度 N/M + 百分比），点击展开/收起；
 * - 正文：进度条 + 任务列表（in_progress 置顶 → pending → completed → cancelled，
 *   组内按 createdAt），空态显示「暂无任务」。
 */
const props = defineProps<{
  /** 看板快照（四期前由调用方供给；tool.task_query 展开态暂无快照数据源，传空数组） */
  tasks: TaskItem[]
}>()

// 嵌入形态：默认折叠，点击头部展开/收起
const isCollapsed = ref(true)

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

const stats = computed(() => {
  const list = props.tasks
  return {
    total: list.length,
    pending: list.filter(x => x.status === 'pending').length,
    inProgress: list.filter(x => x.status === 'in_progress').length,
    completed: list.filter(x => x.status === 'completed').length,
    cancelled: list.filter(x => x.status === 'cancelled').length,
  }
})

// 进度百分比：cancelled 不计入有效总数
const progressPct = computed(() => {
  const s = stats.value
  if (s.total === 0) return 0
  const effective = s.total - s.cancelled
  if (effective === 0) return 100
  return Math.round((s.completed / effective) * 100)
})

// 排序：in_progress 置顶 → pending → completed → cancelled；组内按 createdAt
const sortedTasks = computed(() => {
  const rank = (s: string) =>
    s === 'in_progress' ? 0 : s === 'pending' ? 1 : s === 'completed' ? 2 : 3
  return [...props.tasks].sort((a, b) => {
    const r = rank(a.status) - rank(b.status)
    if (r !== 0) return r
    return (a.createdAt || '').localeCompare(b.createdAt || '')
  })
})

/** 状态图标（desktop 手绘 SVG → lucide 映射，军规 9） */
const statusIconOf = (s: string): string => {
  switch (s) {
    case 'pending': return 'lucide:circle'
    case 'in_progress': return 'lucide:loader-circle'
    case 'completed': return 'lucide:check'
    default: return 'lucide:x'
  }
}
</script>

<template>
  <div class="task-list-view embedded" :class="{ 'has-active': stats.inProgress > 0 }">
    <!-- 嵌入形态：头部可点击展开/折叠 -->
    <div class="tl-header embedded" @click="toggleCollapse">
      <div class="tl-header-left">
        <div
          class="tl-icon"
          :class="{ active: stats.inProgress > 0, done: stats.total > 0 && stats.completed === stats.total }"
        >
          <MxIcon name="lucide:list-todo" :size="16" />
        </div>
        <div class="tl-title-section">
          <h3 class="tl-title">
            任务清单
            <span class="tl-progress-text">{{ stats.completed }}/{{ stats.total }}</span>
          </h3>
          <div v-if="stats.inProgress > 0" class="tl-subtitle">
            正在处理 {{ stats.inProgress }} 项
          </div>
          <div v-else-if="stats.total > 0 && stats.completed === stats.total" class="tl-subtitle muted">
            全部完成
          </div>
        </div>
      </div>
      <div class="tl-header-right">
        <span v-if="stats.total > 0" class="tl-progress-pill">{{ progressPct }}%</span>
        <!-- 嵌入模式：折叠箭头指示 -->
        <MxIcon name="lucide:chevron-down" :size="16" class="tl-chevron" :class="{ rotated: !isCollapsed }" />
      </div>
    </div>

    <div v-show="!isCollapsed" class="tl-body">
      <!-- 进度条 -->
      <div v-if="stats.total > 0" class="tl-progress-bar">
        <div class="tl-progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>

      <!-- 空状态 -->
      <div v-if="stats.total === 0" class="tl-empty">
        暂无任务
      </div>

      <!-- 任务列表 -->
      <ul v-else class="tl-items">
        <li
          v-for="task in sortedTasks"
          :key="task.id"
          class="tl-item"
          :class="['status-' + task.status, { 'is-active': task.status === 'in_progress' }]"
        >
          <span class="tl-status-icon" :class="'icon-' + task.status">
            <MxIcon
              :name="statusIconOf(task.status)"
              :size="16"
              :class="{ 'tl-spin': task.status === 'in_progress' }"
            />
          </span>

          <div class="tl-item-main">
            <el-tooltip :content="task.subject" placement="top" :hide-after="0" :disabled="!task.subject">
              <div class="tl-item-subject">{{ task.subject }}</div>
            </el-tooltip>
            <div
              v-if="(task.status === 'in_progress' && task.activeForm) || task.owner || (task.blockedBy && task.blockedBy.length)"
              class="tl-item-meta"
            >
              <span v-if="task.status === 'in_progress' && task.activeForm" class="tl-active-form">
                <span class="tl-dot-pulse"></span>{{ task.activeForm }}
              </span>
              <span v-if="task.owner" class="tl-tag tl-owner-tag">@{{ task.owner }}</span>
              <span v-if="task.blockedBy && task.blockedBy.length" class="tl-tag tl-blocked-tag">
                <MxIcon name="lucide:ban" :size="16" />
                被 {{ task.blockedBy.length }} 项阻塞
              </span>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.task-list-view {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: transparent;
}

/* 嵌入形态：头部可点击展开/折叠 */
.tl-header.embedded {
  cursor: pointer;
}

.tl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mx-space-2) var(--mx-space-1);
  user-select: none;
  transition: background 0.2s ease;
}

.tl-header:hover {
  background: color-mix(in srgb, var(--mx-accent) 4%, transparent);
}

.tl-header-left {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  min-width: 0;
  flex: 1;
}

.tl-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--mx-radius-control);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 25%, transparent);
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.tl-icon.active {
  background: color-mix(in srgb, var(--mx-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--mx-accent) 40%, transparent);
  animation: tl-icon-pulse 2s ease-in-out infinite;
}

.tl-icon.done {
  color: var(--mx-success);
  background: color-mix(in srgb, var(--mx-success) 16%, transparent);
  border-color: color-mix(in srgb, var(--mx-success) 40%, transparent);
}

@keyframes tl-icon-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mx-accent) 40%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--mx-accent) 0%, transparent); }
}

.tl-title-section {
  min-width: 0;
}

.tl-title {
  font: var(--mx-font-body);
  font-weight: 700;
  letter-spacing: -0.3px;
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  color: var(--mx-text);
  margin: 0;
}

.tl-progress-text {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  font-weight: 600;
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 20%, transparent);
  padding: 1px var(--mx-space-2);
  border-radius: 999px; /* desktop --radius-full 胶囊（附录 A.3：几何值保留字面） */
}

.tl-subtitle {
  font: var(--mx-font-caption);
  color: var(--mx-accent);
  margin-top: var(--mx-space-1);
  font-weight: 500;
}

.tl-subtitle.muted {
  color: var(--mx-success);
}

.tl-header-right {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-shrink: 0;
}

.tl-progress-pill {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  font-weight: 700;
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 22%, transparent);
  padding: 2px var(--mx-space-2);
  border-radius: 999px; /* desktop --radius-full 胶囊（附录 A.3：几何值保留字面） */
}

.tl-chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.tl-chevron.rotated {
  transform: rotate(180deg);
}

.tl-body {
  padding: var(--mx-space-1) var(--mx-space-1) var(--mx-space-2);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

/* 进度条 */
.tl-progress-bar {
  width: 100%;
  height: 4px;
  background: color-mix(in srgb, var(--mx-text-tertiary) 12%, transparent);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: var(--mx-space-3);
}

.tl-progress-fill {
  height: 100%;
  background: var(--mx-accent);
  border-radius: 2px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.tl-empty {
  padding: var(--mx-space-5) var(--mx-space-3);
  text-align: center;
  color: var(--mx-text-tertiary);
  font: var(--mx-font-caption);
  font-style: italic;
}

/* 任务列表 */
.tl-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.tl-item {
  display: flex;
  align-items: flex-start;
  gap: var(--mx-space-3);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  transition: background 0.15s ease;
  position: relative;
}

.tl-item:hover {
  background: color-mix(in srgb, var(--mx-text-tertiary) 5%, transparent);
}

/* in_progress 项：左侧色条 + 微高亮背景 */
.tl-item.is-active {
  background: linear-gradient(90deg, color-mix(in srgb, var(--mx-accent) 10%, transparent), color-mix(in srgb, var(--mx-accent) 2%, transparent));
}

.tl-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 2px;
  background: var(--mx-accent);
}

.tl-status-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tl-status-icon.icon-pending { color: var(--mx-text-tertiary); }
.tl-status-icon.icon-in_progress { color: var(--mx-accent); }
.tl-status-icon.icon-completed { color: var(--mx-success); }
.tl-status-icon.icon-cancelled { color: var(--mx-text-tertiary); }

.tl-spin {
  animation: tl-spin 1.2s linear infinite;
}

@keyframes tl-spin {
  to { transform: rotate(360deg); }
}

.tl-item-main {
  flex: 1;
  min-width: 0;
}

.tl-item-subject {
  font: var(--mx-font-caption);
  line-height: 1.5;
  color: var(--mx-text-secondary);
  word-break: break-word;
}

.tl-item.status-completed .tl-item-subject {
  color: var(--mx-text-tertiary);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--mx-success) 50%, transparent);
}

.tl-item.status-cancelled .tl-item-subject {
  color: var(--mx-text-tertiary);
  text-decoration: line-through;
  opacity: 0.6;
}

.tl-item.is-active .tl-item-subject {
  color: var(--mx-text);
  font-weight: 600;
}

.tl-item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-1);
}

.tl-active-form {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-accent);
  font-style: italic;
}

.tl-dot-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mx-accent);
  animation: tl-dot-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes tl-dot-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

.tl-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  font: var(--mx-font-micro);
  font-family: var(--mx-font-mono);
  font-weight: 600;
  padding: 1px var(--mx-space-2);
  border-radius: 999px; /* desktop --radius-full 胶囊（附录 A.3：几何值保留字面） */
  border: 1px solid transparent;
}

.tl-owner-tag {
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--mx-accent) 22%, transparent);
}

.tl-blocked-tag {
  color: var(--mx-warning);
  background: color-mix(in srgb, var(--mx-warning) 10%, transparent);
  border-color: color-mix(in srgb, var(--mx-warning) 25%, transparent);
}
</style>
