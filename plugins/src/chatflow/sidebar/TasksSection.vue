<script setup lang="ts">
/**
 * TasksSection —— Sidebar「Tasks」分节组件席位（概念框架 §7.2，源 AgentSwitcher /
 * SessionDrawer 仅作参考不搬形状）。
 *
 * 列表形态（全量分组制，2026-09-26 定稿）：一次性拉取全量会话（store.loadSessions，
 * session.list 无参），本地按目录名（工作目录去路径）分组；分组跟随当前 Agent
 * （Agent 变化分组随之刷新）。「最近讨论」捷径区取 Daemon 范围内最近活跃会话
 * （跨 Agent，daemon 按 LastActivityAt 倒序返回，前端截取前 N 条）。
 *
 * 行四要素：任务名（title）+ 运行状态（busySessions）+ 最后活动时间 + 未读标记
 * （store.unreadBySession，后台会话终态事件计数）；无内容预览。
 *
 * 点击语义（捷径）：点击任务行 = 直接打开该工作目录 → 加载该会话消息
 * （switchToSession 内先切 Agent 再切会话，一步直达）；「新会话」= 清空对话流
 * （保留目录与 Agent，会话懒建于首条消息发送时）+ 激活对话页。
 *
 * Agent 切换器（源 AgentSwitcher 形态移植）：数据消费 agents.registry 服务
 * （插件间禁止 import，消费侧本地声明形状），仅列已招募（hired）Agent；
 * currentAgent 为空时自动选中首个已招募 Agent（新会话归属与发送前置）。
 *
 * 样式：全量 --mx-* 语义 token（军规 3），desktop token 按移植计划附录 A 映射；
 * 行几何对齐壳 SidebarPane 行（34px / radius 8），按钮卡对齐壳 rowButton（38px）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MxIcon, useShell, useService } from '@mindx-work/ui-shell-vue'
import { useChatflowStore } from '../store'
import { CHATFLOW_HOME_ID } from '../ids'
import type { Session } from '../model/session'

// ── agents.registry 服务结构契约（消费侧本地声明，插件间禁止 import）──
interface AgentsRegistry {
  list(): Promise<
    Array<{
      name: string
      role?: string
      nick_name?: string
      description?: string
      icon?: string
      hired?: boolean
    }>
  >
}

const agentsRegistry = useService<AgentsRegistry>('agents.registry')
const shell = useShell()
const store = useChatflowStore()

// ── 折叠 rail 形态（壳传 compact）：仅渲染「新任务」36px 图标钮 ──
const props = defineProps<{ compact?: boolean }>()

// ── Agent 清单（仅已招募）──
const agents = ref<Array<{ name: string; role?: string; nick_name?: string; icon?: string }>>([])
const agentsLoading = ref(false)

async function refreshAgents(): Promise<void> {
  agentsLoading.value = true
  try {
    const list = await agentsRegistry.list()
    agents.value = (list || [])
      .filter((a) => a.hired)
      .map((a) => ({ name: a.name, role: a.role, nick_name: a.nick_name, icon: a.icon }))
    // 缺省选中：currentAgent 为空时取首个已招募 Agent（新会话归属与发送前置）
    if (!store.currentAgent && agents.value[0]) {
      store.currentAgent = agents.value[0].name
    }
  } catch (err) {
    console.warn('[ChatFlow] Agent 清单加载失败:', err)
  } finally {
    agentsLoading.value = false
  }
}

/**
 * 触发器与下拉项展示（显示规则：昵称主名 + Role 小字，昵称缺失回退 role，
 * role 小字仅昵称生效时显示避免重复；头像 icon 优先、首字兜底）
 */
const currentAgentInfo = computed(() => agents.value.find((a) => a.name === store.currentAgent) || null)
const agentDisplayName = (a?: { name: string; role?: string; nick_name?: string } | null): string =>
  a?.nick_name || a?.role || a?.name || ''
// 悬空引用（会话归属的 Agent 已不在已招募列表）直接显示该 Agent 名，不落「未选择」
const triggerName = computed(() => {
  if (agentsLoading.value && !agents.value.length) return '加载中…'
  return agentDisplayName(currentAgentInfo.value) || store.currentAgent || '未选择'
})
const triggerRole = computed(() => (currentAgentInfo.value?.nick_name && currentAgentInfo.value.role ? currentAgentInfo.value.role : ''))

function handleAgentCommand(command: string | number | object): void {
  const name = String(command)
  if (!name || name === store.currentAgent) return
  store.currentAgent = name
}

// ── 全量分组制：按目录名分组，分组跟随当前 Agent（desktop 同构：无 agent 归属的会话随当前 Agent 展示）──
const RECENT_LIMIT = 5

function dirBasename(dir?: string): string {
  const d = (dir || '').replace(/\/+$/, '')
  if (!d) return ''
  return d.split('/').pop() || d
}

const groupedSessions = computed(() => store.sessions.filter((s) => !s.agent_name || s.agent_name === store.currentAgent))

const groups = computed(() => {
  const map = new Map<string, Session[]>()
  for (const s of groupedSessions.value) {
    const label = dirBasename(s.project_dir) || '未指定目录'
    const bucket = map.get(label)
    if (bucket) bucket.push(s)
    else map.set(label, [s])
  }
  // 组间按组内最近活跃倒序（daemon 全量已按 LastActivityAt 倒序，组首即组内最新）
  return Array.from(map.entries())
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => recency(b.items[0]) - recency(a.items[0]))
})

/** 「最近讨论」捷径区：Daemon 全范围最近活跃（跨 Agent），直接截取全量列表头部 */
const recentSessions = computed(() => store.sessions.slice(0, RECENT_LIMIT))

function recency(s?: Session): number {
  if (!s) return 0
  const t = Date.parse(s.updated_at)
  return Number.isNaN(t) ? 0 : t
}

// ── 行四要素辅助 ──
/** 最近讨论区归属标识：按 agent 名查已招募清单（昵称主名 + 头像），悬空引用回退英文名 */
const agentTagLabel = (name?: string): string => {
  if (!name) return ''
  const a = agents.value.find((x) => x.name === name)
  return a?.nick_name || a?.role || name
}
const agentIconOf = (name?: string): string | undefined =>
  agents.value.find((x) => x.name === name)?.icon

function rowTitle(s: Session): string {
  return s.title || '未命名任务'
}

function isRunning(sessionId: string): boolean {
  return !!store.busySessions[sessionId]
}

function hasUnread(sessionId: string): boolean {
  return (store.unreadBySession[sessionId] || 0) > 0
}

/** 最后活动时间（源 SessionDrawer formatTime 语义平移，文案中文化） */
function formatTime(timeStr?: string): string {
  if (!timeStr) return ''
  const date = new Date(timeStr)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffDays = Math.floor(diffMins / 1440)
  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`
  if (diffDays < 30) return `${diffDays} 天前`
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ── 分组折叠：分组头可点击折叠/展开（内存态，与壳 footerCollapsed 同策略不持久化）──
/** 键 = 分组标签（工作目录名）；「最近讨论」捷径区用保留前缀避免与目录名撞键 */
const RECENT_GROUP_KEY = '__recent__'
const collapsedGroups = ref<Set<string>>(new Set())

function isGroupCollapsed(label: string): boolean {
  return collapsedGroups.value.has(label)
}

function toggleGroup(label: string): void {
  const next = new Set(collapsedGroups.value)
  if (next.has(label)) next.delete(label)
  else next.add(label)
  collapsedGroups.value = next
}

// ── 动作 ──
function openSession(sessionId: string): void {
  void store.switchToSession(sessionId)
  shell.Content.activate(CHATFLOW_HOME_ID)
}

// ── 行尾弹出菜单（hover 显现）：重命名（session.rename）+ 删除（session.delete）──
/** 行内重命名态：editingId 命中的行渲染底线输入框（Enter/失焦保存，Esc 取消） */
const editingId = ref<string | null>(null)
const editTitle = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

function startRename(s: Session): void {
  editingId.value = s.session_id
  editTitle.value = s.title || ''
  void nextTick(() => renameInput.value?.focus())
}

/** v-for 内函数式 ref：仅当前编辑行的 input 被注册（字符串 ref 会数组化） */
function setRenameInput(el: unknown): void {
  renameInput.value = el instanceof HTMLInputElement ? el : null
}

function cancelRename(): void {
  editingId.value = null
  editTitle.value = ''
}

async function commitRename(sessionId: string): Promise<void> {
  if (editingId.value !== sessionId) return
  const title = editTitle.value.trim()
  cancelRename()
  if (!title) return // 置空视作取消，保持原标题
  try {
    await store.renameSession(sessionId, title)
  } catch {
    ElMessage({ message: '重命名失败', type: 'error', duration: 2000 })
  }
}

async function removeSession(s: Session): Promise<void> {
  const label = s.title || '未命名任务'
  try {
    await ElMessageBox.confirm(`确定删除「${label.slice(0, 30)}」吗？会话消息一并删除，不可恢复。`, '删除任务', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  try {
    await store.deleteSession(s.session_id)
    ElMessage({ message: '已删除', type: 'success', duration: 2000 })
  } catch {
    ElMessage({ message: '删除失败', type: 'error', duration: 2000 })
  }
}

function handleSessionCommand(command: string, s: Session): void {
  if (command === 'rename') startRename(s)
  else if (command === 'delete') void removeSession(s)
}

function handleNewSession(): void {
  // 新会话 = 清空对话流（保留目录与 Agent），会话懒建于首条消息发送时
  store.clearActiveStream()
  shell.Content.activate(CHATFLOW_HOME_ID)
}

function reloadSessions(): void {
  void store.loadSessions()
}

// ── 初始拉取：连接建立时机（desktop ActivityPane L172-184 同构）──────────
// 组件挂载早于 ws 建连，onMounted 直拉必然 reject（daemon.call 未 OPEN 直接拒绝）；
// 已连接立即执行（晚挂载场景），状态跃迁 connected 时执行（重连再次触发同语义）
function fetchInitialData(): void {
  if (!store.sessionsLoaded) void store.loadSessions()
  void refreshAgents()
}
if (store.isConnected) fetchInitialData()
watch(
  () => store.isConnected,
  (connected) => {
    if (connected) fetchInitialData()
  },
)
</script>

<template>
  <!-- 折叠 rail：36px「新任务」图标钮（对齐壳折叠行节奏） -->
  <button v-if="props.compact" type="button" :class="$style.railBtn" @click="handleNewSession">
    <MxIcon name="lucide:plus" :size="20" />
  </button>

  <div v-else :class="$style.root">
    <!-- Agent 切换器：头像 + 昵称主名 + 右侧 Role 小字（昵称缺失回退 role），下拉仅列已招募 Agent
         （popper-class：面板样式落在 EP popper 外壳，消除外壳/内层 UL 双框） -->
    <el-dropdown trigger="click" popper-class="chatflow-agent-menu" @command="handleAgentCommand">
      <button type="button" :class="$style.agentTrigger">
        <img v-if="currentAgentInfo?.icon" :src="currentAgentInfo.icon" :class="$style.agentAvatar" alt="" />
        <span v-else :class="[$style.agentAvatar, $style.agentAvatarFallback]">{{ triggerName.charAt(0) }}</span>
        <span :class="$style.agentName">{{ triggerName }}</span>
        <span v-if="triggerRole" :class="$style.agentRole">{{ triggerRole }}</span>
        <MxIcon name="lucide:chevron-down" :size="16" :class="$style.agentArrow" />
      </button>
      <template #dropdown>
        <el-dropdown-menu class="chatflow-agent-menu">
          <el-dropdown-item
            v-for="a in agents"
            :key="a.name"
            :command="a.name"
            :disabled="a.name === store.currentAgent"
          >
            <img v-if="a.icon" :src="a.icon" class="chatflow-agent-item-avatar" alt="" />
            <span v-else class="chatflow-agent-item-avatar chatflow-agent-item-avatar-fb">{{ agentDisplayName(a).charAt(0) }}</span>
            <span class="chatflow-agent-item-name">{{ agentDisplayName(a) }}</span>
            <span v-if="a.nick_name && a.role" class="chatflow-agent-item-role">{{ a.role }}</span>
          </el-dropdown-item>
          <el-dropdown-item v-if="!agents.length" disabled>
            <span class="chatflow-agent-item-name">{{ agentsLoading ? '加载中…' : '暂无已招募的 Agent' }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- 「任务」分组标题（Agent 切换器与新任务按钮之间，形态对齐分组头） -->
    <div :class="$style.groupHeader">
      <span :class="$style.groupTitle">任务</span>
    </div>

    <!-- 新任务按钮卡（几何对齐壳 rowButton：38 高 / 0.5px 边框 / radius 12 / elevated 填充） -->
    <button type="button" :class="$style.newSessionBtn" @click="handleNewSession">
      <MxIcon name="lucide:plus" :size="16" />
      <span>新任务</span>
    </button>

    <!-- 骨架：加载中且未就绪（保持到内容完全加载） -->
    <div v-if="store.sessionsLoading && !store.sessionsLoaded" :class="$style.skeleton">
      <el-skeleton-item v-for="i in 4" :key="i" variant="rectangle" :class="$style.skeletonRow" />
    </div>

    <!-- 空态 / 加载失败重试（button：键盘可达 + focus 态齐全） -->
    <button
      v-else-if="groups.length === 0 && recentSessions.length === 0"
      type="button"
      :class="$style.empty"
      @click="reloadSessions"
    >
      {{ store.sessionsLoaded ? '暂无会话' : '会话加载失败，点击重试' }}
    </button>

    <template v-else>
      <!-- 全量分组制：按目录名分组，行四要素；分组头可点击折叠/展开（chevron 右缘） -->
      <section v-for="g in groups" :key="g.label" :class="$style.group">
        <button
          type="button"
          :class="$style.groupHeader"
          :aria-expanded="isGroupCollapsed(g.label) ? 'false' : 'true'"
          @click="toggleGroup(g.label)"
        >
          <span :class="$style.groupTitle">{{ g.label }}</span>
          <span :class="$style.groupCount">{{ g.items.length }}</span>
          <MxIcon
            name="lucide:chevron-down"
            :size="16"
            :class="[$style.groupChevron, { [$style.groupChevronCollapsed]: isGroupCollapsed(g.label) }]"
          />
        </button>
        <!-- grid 0fr→1fr 行高过渡：折叠平滑收拢（对齐壳 footer 折叠技巧） -->
        <div :class="$style.groupBody" :data-collapsed="isGroupCollapsed(g.label) ? 'true' : 'false'">
          <div :class="$style.groupClip">
            <div
              v-for="s in g.items"
              :key="s.session_id"
              :class="$style.sessionRow"
              :data-active="s.session_id === store.activeSessionId ? 'true' : 'false'"
            >
              <button
                v-if="editingId !== s.session_id"
                type="button"
                :class="$style.rowMain"
                @click="openSession(s.session_id)"
              >
                <!-- 行首聊天图标：任务分组行无 Agent 头像，以聊天图标标识会话身份；运行中呼吸 -->
                <MxIcon
                  name="lucide:message-circle"
                  :size="16"
                  :class="[$style.rowChatIcon, { [$style.breathing]: isRunning(s.session_id) }]"
                />
                <el-tooltip :content="rowTitle(s)" placement="right" :show-after="500" :offset="8">
                  <span :class="$style.rowTitle">{{ rowTitle(s) }}</span>
                </el-tooltip>
                <span v-if="isRunning(s.session_id)" :class="$style.runningDot" />
                <span v-if="hasUnread(s.session_id)" :class="$style.unreadDot" />
                <span :class="$style.rowTime">{{ formatTime(s.updated_at) }}</span>
              </button>
              <!-- 行尾弹出菜单（hover 显现）：重命名 / 删除（编辑态隐藏避免抢占输入焦点） -->
              <el-dropdown
                v-if="editingId !== s.session_id"
                trigger="click"
                popper-class="chatflow-agent-menu"
                @command="(cmd: string) => handleSessionCommand(cmd, s)"
              >
                <button type="button" :class="$style.rowMore" title="会话操作" @click.stop>
                  <MxIcon name="lucide:ellipsis" :size="16" />
                </button>
                <template #dropdown>
                  <el-dropdown-menu class="chatflow-agent-menu">
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="delete">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <!-- 行内重命名（底线输入，对齐昵称编辑先例）：编辑态占满整行 -->
              <input
                v-if="editingId === s.session_id"
                :ref="setRenameInput"
                v-model="editTitle"
                :class="$style.rowRenameInput"
                placeholder="任务名"
                @keydown.enter.prevent="commitRename(s.session_id)"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename(s.session_id)"
                @click.stop
              />
            </div>
          </div>
        </div>
      </section>

      <!-- 「最近讨论」捷径区：跨 Agent 最近活跃（先切 Agent 再切会话，switchToSession 内完成）。
           上方分组列表非空时整区隐藏——捷径区内容与其高度重复，避免同屏双列表 -->
      <section
        v-if="recentSessions.length > 0 && groups.length === 0"
        :class="$style.recent"
      >
        <button
          type="button"
          :class="$style.groupHeader"
          :aria-expanded="isGroupCollapsed(RECENT_GROUP_KEY) ? 'false' : 'true'"
          @click="toggleGroup(RECENT_GROUP_KEY)"
        >
          <span :class="$style.groupTitle">最近讨论</span>
          <MxIcon
            name="lucide:chevron-down"
            :size="16"
            :class="[$style.groupChevron, { [$style.groupChevronCollapsed]: isGroupCollapsed(RECENT_GROUP_KEY) }]"
          />
        </button>
        <div :class="$style.groupBody" :data-collapsed="isGroupCollapsed(RECENT_GROUP_KEY) ? 'true' : 'false'">
          <div :class="$style.groupClip">
            <div
              v-for="s in recentSessions"
              :key="s.session_id"
              :class="$style.sessionRow"
              :data-active="s.session_id === store.activeSessionId ? 'true' : 'false'"
            >
              <button
                v-if="editingId !== s.session_id"
                type="button"
                :class="$style.rowMain"
                @click="openSession(s.session_id)"
              >
                <!-- 行首 Agent 头像（icon 优先、昵称/英文名首字兜底）：跨 Agent 捷径区标识归属；运行中呼吸 -->
                <img
                  v-if="agentIconOf(s.agent_name)"
                  :src="agentIconOf(s.agent_name)"
                  :class="[$style.rowAvatar, { [$style.breathing]: isRunning(s.session_id) }]"
                  alt=""
                />
                <span
                  v-else-if="s.agent_name"
                  :class="[$style.rowAvatar, $style.rowAvatarFallback, { [$style.breathing]: isRunning(s.session_id) }]"
                >
                  {{ agentTagLabel(s.agent_name).charAt(0) }}
                </span>
                <el-tooltip :content="rowTitle(s)" placement="right" :show-after="500" :offset="8">
                  <span :class="$style.rowTitle">{{ rowTitle(s) }}</span>
                </el-tooltip>
                <span v-if="isRunning(s.session_id)" :class="$style.runningDot" />
                <span v-if="hasUnread(s.session_id)" :class="$style.unreadDot" />
                <span :class="$style.rowTime">{{ formatTime(s.updated_at) }}</span>
              </button>
              <!-- 行尾弹出菜单（hover 显现）：重命名 / 删除（编辑态隐藏避免抢占输入焦点） -->
              <el-dropdown
                v-if="editingId !== s.session_id"
                trigger="click"
                popper-class="chatflow-agent-menu"
                @command="(cmd: string) => handleSessionCommand(cmd, s)"
              >
                <button type="button" :class="$style.rowMore" title="会话操作" @click.stop>
                  <MxIcon name="lucide:ellipsis" :size="16" />
                </button>
                <template #dropdown>
                  <el-dropdown-menu class="chatflow-agent-menu">
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="delete">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <!-- 行内重命名（底线输入，对齐昵称编辑先例）：编辑态占满整行 -->
              <input
                v-if="editingId === s.session_id"
                :ref="setRenameInput"
                v-model="editTitle"
                :class="$style.rowRenameInput"
                placeholder="任务名"
                @keydown.enter.prevent="commitRename(s.session_id)"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename(s.session_id)"
                @click.stop
              />
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style module>
/* 根：填满分节席位（壳 sectionComponent 已承载 flex:1 / min-height:0），内部自滚动 */
.root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  overflow-y: auto;
  overflow-x: hidden;
  /* Sidebar 出现滚动时不显示滚动条（滚轮/触控板滚动能力保留） */
  scrollbar-width: none;
  padding: 0 2px var(--mx-space-1);
}

.root::-webkit-scrollbar {
  display: none;
}

/* ── Agent 切换器触发器（头像 + 昵称主名 + 右侧 Role 小字 + 下拉箭头）── */
.agentTrigger {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 var(--mx-space-2);
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.agentTrigger:hover {
  background: var(--mx-hover);
}

.agentTrigger:active {
  background: var(--mx-active);
}

.agentTrigger:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

/* 头像：20px 圆形，icon 优先、首字兜底（accent 淡底居中） */
.agentAvatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.agentAvatarFallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: var(--mx-font-micro);
  font-weight: 600;
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
}

/* 昵称主名（昵称缺失回退 role/name） */
.agentName {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

/* Role 小字：右侧次级（仅昵称生效时显示） */
.agentRole {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.agentArrow {
  flex-shrink: 0;
  color: var(--mx-text-tertiary);
}

/* ── 行首聊天图标（任务分组行）：会话身份标识，tertiary 弱化不抢任务名 ── */
.rowChatIcon {
  flex-shrink: 0;
  color: var(--mx-text-tertiary);
}

/* ── 运行中呼吸：行首元素明暗交替（头像/聊天图标通用）；
      prefers-reduced-motion 用户关动画，保留静态运行点 ── */
.breathing {
  animation: breathe 2.4s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .breathing {
    animation: none;
  }
}

/* ── 新会话按钮卡（对齐壳 rowButton：38 高 / 0.5px 边框 / radius 12 / elevated 填充 / 500 字重）── */
.newSessionBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 38px;
  flex-shrink: 0;
  padding: 8px var(--mx-space-4);
  box-sizing: border-box;
  font: var(--mx-font-body);
  font-weight: 500;
  color: var(--mx-text);
  background: var(--mx-btn-elevated);
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.newSessionBtn:hover {
  background: var(--mx-hover-solid);
}

.newSessionBtn:active {
  background: var(--mx-hover-solid);
}

.newSessionBtn:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

/* ── 骨架（加载中且未就绪）── */
.skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding-top: var(--mx-space-1);
}

.skeletonRow {
  display: block;
  width: 100%;
  height: 34px;
  border-radius: var(--mx-radius-control);
}

/* ── 空态 / 加载失败（button：键盘可达，点击重试）── */
.empty {
  display: block;
  width: 100%;
  padding: var(--mx-space-4);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  text-align: center;
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
}

.empty:hover {
  background: var(--mx-hover);
}

.empty:active {
  background: var(--mx-active);
}

.empty:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

/* ── 分组 ── */
.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

/* ── 分组头（button：整行可点击折叠/展开，标题左 / 计数与 chevron 右）──
   用户定稿（2026-10-03 截图批注）：分组头无背景、字体统一小字（caption）、
   上下留白增大、右侧折叠指示默认隐藏 hover 才显现 */
.groupHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  margin: var(--mx-space-2) 0 var(--mx-space-1);
  padding: 0 var(--mx-space-1) 0 4px;
  flex-shrink: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.groupHeader:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.groupTitle {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.groupCount {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  background: var(--mx-hover);
  border-radius: 999px;
  padding: 0 6px;
  flex-shrink: 0;
}

/* 折叠指示：靠行右缘，默认隐藏、hover 分组头才显现；折叠转 -90°（朝右），展开朝下 */
.groupChevron {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--mx-text-tertiary);
  opacity: 0;
  transition: transform var(--mx-duration-fast) var(--mx-ease-standard),
    opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.groupHeader:hover .groupChevron,
.groupHeader:focus-visible .groupChevron {
  opacity: 1;
}

.groupChevronCollapsed {
  transform: rotate(-90deg);
}

/* 折叠体：grid 0fr→1fr 行高过渡（内容随行高收拢，展开/收起平滑） */
.groupBody {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--mx-duration-motion) var(--mx-ease-standard);
}

.groupBody[data-collapsed='true'] {
  grid-template-rows: 0fr;
}

/* 裁切层：min-height 0 允许行高压到 0；visibility 过渡保证折叠后焦点不可达 */
.groupClip {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  visibility: visible;
  transition: visibility var(--mx-duration-motion) var(--mx-ease-standard);
}

.groupBody[data-collapsed='true'] .groupClip {
  visibility: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .groupChevron,
  .groupBody,
  .groupClip {
    transition: none;
  }
}

/* ── 会话行（几何对齐壳行：34 高 / radius 8 / padding 0 8 / gap 6）── */
.sessionRow {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  padding: 0 var(--mx-space-2);
  box-sizing: border-box;
  flex-shrink: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: default;
  text-align: left;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.sessionRow:hover:not([data-active='true']) {
  background: var(--mx-hover);
}

.sessionRow:active:not([data-active='true']) {
  background: var(--mx-active);
}

.sessionRow:focus-within {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

/* 选中态（状态而非交互态）：灰底，对齐壳行 data-active 语义 */
.sessionRow[data-active='true'] {
  background: var(--mx-hover);
}

/* 行内主点击区（button 重置 + 填满行），行容器（div）承载 hover 菜单 */
.rowMain {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

/* 行尾弹出菜单触发器（⋯）：默认隐藏，hover 行才显现（可感知鼠标） */
.rowMore {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  flex-shrink: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard),
    background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.sessionRow:hover .rowMore,
.rowMore:focus-visible {
  opacity: 1;
}

.rowMore:hover {
  color: var(--mx-text);
  background: var(--mx-active);
}

/* 行内重命名输入（底线样式，对齐昵称编辑先例） */
.rowRenameInput {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 var(--mx-space-1);
  border: none;
  border-bottom: 1px solid var(--mx-accent);
  background: transparent;
  outline: none;
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.rowRenameInput::placeholder {
  color: var(--mx-text-tertiary);
}

.rowTitle {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 运行状态：品牌色呼吸点（后台会话执行中） */
.runningDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mx-accent);
  flex-shrink: 0;
  animation: mx-tasks-pulse 1.2s var(--mx-ease-standard) infinite alternate;
}

@keyframes mx-tasks-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.4;
  }
}

/* 未读标记：危险色点（后台会话终态事件计数） */
.unreadDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mx-danger);
  flex-shrink: 0;
}

.rowTime {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}

/* 「最近讨论」区：跨 Agent 捷径（顶部分隔线，Finder 式捷径区语义） */
.recent {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  margin-top: var(--mx-space-1);
  padding-top: var(--mx-space-1);
  border-top: 1px solid var(--mx-separator-soft);
}

/* 分隔线已承载上方留白，抵消分组头通用 margin-top（避免双重叠加） */
.recent .groupHeader {
  margin-top: 0;
}

/* 最近讨论区行首头像：16px 圆形，icon 优先、首字兜底（accent 淡底居中） */
.rowAvatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.rowAvatarFallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: var(--mx-font-micro);
  font-weight: 600;
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
}

/* ── 折叠 rail：36px 图标钮（对齐壳折叠行几何）── */
.railBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--mx-radius-card);
  background: transparent;
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.railBtn:hover {
  background: var(--mx-hover);
}

.railBtn:active {
  background: var(--mx-active);
}

.railBtn:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}
</style>

<style>
/* ── Agent 切换下拉菜单（渲染到 body，需全局作用域；全 --mx-* token）──
   面板样式落在 popper 外壳本体（popper-class 直达），内层 UL 透明承载，
   箭头隐藏——消除 EP 默认外壳底色/描边与自绘面板的双框 */
.el-dropdown__popper.chatflow-agent-menu {
  min-width: 200px;
  background: var(--mx-bg-elevated) !important;
  border: 1px solid color-mix(in srgb, var(--mx-accent) 25%, transparent) !important;
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-1);
  box-shadow: var(--mx-shadow-panel);
  overflow: hidden;
}

.el-dropdown__popper.chatflow-agent-menu .el-popper__arrow {
  display: none;
}

.el-dropdown__popper.chatflow-agent-menu .el-dropdown-menu {
  background: transparent;
  border: none;
  padding: 0;
  box-shadow: none;
}

.chatflow-agent-menu .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  color: var(--mx-text);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-2) var(--mx-space-3);
  line-height: 1.4;
}

.chatflow-agent-menu .el-dropdown-menu__item:not(.is-disabled):hover,
.chatflow-agent-menu .el-dropdown-menu__item:not(.is-disabled):focus {
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  color: var(--mx-accent);
}

.chatflow-agent-menu .el-dropdown-menu__item.is-disabled {
  color: var(--mx-text-tertiary);
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
  cursor: default;
}

/* 下拉项头像：18px 圆形，icon 优先、首字兜底 */
.chatflow-agent-item-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.chatflow-agent-item-avatar-fb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: var(--mx-font-micro);
  font-weight: 600;
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
}

/* 昵称主名（昵称缺失回退 role/name） */
.chatflow-agent-item-name {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Role 小字：右侧次级（仅昵称生效时显示） */
.chatflow-agent-item-role {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  margin-left: auto;
  white-space: nowrap;
}

.chatflow-agent-menu .el-dropdown-menu__item.is-disabled .chatflow-agent-item-name {
  color: var(--mx-text-tertiary);
}
</style>
