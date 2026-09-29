<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import type { ChatRound as Round, ChatMessage } from '../model/message'
import type { RoundTree } from '../tree/builder'
import TreeView from '../tree/shell/TreeView.vue'
import NodeCard from '../tree/shell/NodeCard.vue'
import { useNodeActions } from '../tree/shell/useNodeActions'
import RoundHeader from '../tree/round/RoundHeader.vue'
import RoundFooter from '../tree/round/RoundFooter.vue'
import type { ContentNode, TurnUsage } from '../tree/types/content'
import type { NodeActionId } from '../tree/registry/actions'
import type { TreeNode } from '../tree/types'
import { formatDuration } from '../toolViewUtils'

/**
 * ChatRound — 一轮对话的聚合容器（对话流时间线树模式）。
 *
 * 渲染顺序（PR §3.6 顶层布局）：
 *   1. 轮头 RoundHeader（user 消息，含回退/删除/复制）
 *   2. 过程树 TreeView（执行中直播；轮结束收拢为「Agent 行 · 耗时」摘要行）
 *   3. 最终答案 content（finishReason=stop，树外常显不折叠）
 *   4. 轮 footer RoundFooter（文件变更摘要 | 用量统计，常显）
 *   5. 残余消息（builder 无法归入节点类型的系统杂项，默认分支兜底，审计不丢内容）
 *
 * 轮内过程（thinking / 工具 / 阻塞 / 子任务 / 压缩 / 中断等）全部经 builder
 * 归一为树节点由 TreeView 渲染，不再有独立消息映射——阶段互斥、折叠策略、
 * 操作分派均由树壳承担（PR §3.4 / 取舍 6）。
 *
 * work 适配：desktop 版的 chatStore 依赖（sessionCurrentAgentName / isBusy）
 * 改 props 注入——组件保持纯渲染，会话状态由宿主层（fixture / 四期 store）供给。
 */
const props = defineProps<{
  round: Round
  /** 执行 agent 显示名（desktop 取 chatStore.sessionCurrentAgentName，work 由宿主注入） */
  agentLabel?: string
  /** 执行 agent 身份（头像/昵称/role，宿主经 agents.registry 解析；缺省回退 agentLabel） */
  agentIdentity?: { name: string; nickName?: string; role?: string; icon?: string }
  /** 本轮是否执行中（desktop 取 chatStore.isBusy，work 由宿主注入；驱动树尾 pending 行） */
  roundExecuting?: boolean
  /** 本轮节点树（ChatArea 全会话构建后按轮分发，builder 按轮记忆化） */
  roundTree?: RoundTree | null
}>()

const emit = defineEmits<{
  (e: 'undo-round', messageId: number, restoreContent?: string): void
  (e: 'permission-grant', data: any): void
  (e: 'permission-deny', reason: string): void
  (e: 'retry', messageId: string): void
  (e: 'dismiss', messageId: string): void
  (e: 'open-settings'): void
}>()

const { dispatch } = useNodeActions()

// ── 树分流：最终答案树外常显（§3.6），其余节点进过程树 ────────────────────

const allNodes = computed<TreeNode[]>(() => props.roundTree?.nodes || [])

const answerNodes = computed<ContentNode[]>(() =>
  allNodes.value.filter((n): n is ContentNode => n.type === 'content' && n.finishReason === 'stop')
)

const processNodes = computed<TreeNode[]>(() =>
  allNodes.value.filter(n => !(n.type === 'content' && n.finishReason === 'stop'))
)

/** 残余消息（builder 无法归入 32 种节点类型的系统杂项，默认分支兜底） */
const residualMessages = computed<ChatMessage[]>(() => props.roundTree?.residual || [])

// ── 顶层布局：轮结束过程树收拢为「Agent 行 · 耗时」摘要行（取舍 11） ───────

const isFinal = computed(() => props.round.hasFinalAnswer || !props.roundExecuting)

// 执行中直播树；轮结束（实时收尾或历史恢复）默认收拢，用户点击 Agent 行展开。
// isFinal 双向驱动：执行开始（isFinal 翻 false）自动展开进入直播，结束自动收回；
// 过渡之间用户手动开合不被覆盖（watch 只在状态翻转时赋值）。
const treeCollapsed = ref(isFinal.value)

watch(isFinal, final => {
  treeCollapsed.value = final
})

/** 轮总耗时（§3.5 轮层）：轮内消息时间跨度，数据源 = Message.Timestamp */
const roundDurationMs = computed(() => {
  const msgs = props.round.messages
  const first = msgs[0]
  const last = msgs[msgs.length - 1]
  if (!first || !last || msgs.length < 2) return undefined
  const start = Date.parse(first.timestamp)
  const end = Date.parse(last.timestamp)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined
  return end - start
})

/** 轮是否执行中（驱动树尾 pending 行：LLM 建流空窗指示） */
const roundExecuting = computed(() => !!props.roundExecuting)

/**
 * 轮头 Agent 身份显示（与侧栏同规则）：昵称主名回退 role 再回退 agentLabel；
 * role 小字仅昵称生效时显示避免重复；头像 icon 优先、首字兜底。
 */
const agentPrimaryName = computed(
  () => props.agentIdentity?.nickName || props.agentIdentity?.role || props.agentLabel || 'Agent'
)
const agentRoleText = computed(() => (props.agentIdentity?.nickName ? props.agentIdentity?.role || '' : ''))
const agentInitial = computed(() => (agentPrimaryName.value || 'A').trim().charAt(0).toUpperCase())

// ── 轮 footer 数据（§4.3：跟着轮走的功能归轮根渲染层） ────────────────────

/**
 * 整轮 token 用量（权威值）：desktop 按轮跨度从全会话消息流聚合；
 * work 改从本轮 messages 聚合（builder 按轮分组后即等价轮跨度，跳过 user 消息本体）。
 */
const footerUsage = computed<TurnUsage | null>(() => {
  const userId = props.round.userMessage?.id
  let pt = 0, ct = 0, ca = 0, calls = 0, cost = 0
  for (const m of props.round.messages) {
    if (userId && m.id === userId) continue
    const u = m.tokenUsage
    if (u) {
      pt += u.prompt_tokens || 0
      ct += u.completion_tokens || 0
      ca += u.cached_tokens || 0
      calls += u.call_count || 1
    }
    cost += m.cost || 0
  }
  if (pt === 0 && ct === 0) return null
  return {
    promptTokens: pt,
    completionTokens: ct,
    totalTokens: pt + ct,
    cachedTokens: ca,
    actualTokens: Math.max(0, pt + ct - ca),
    callCount: calls,
    cost,
  }
})

/**
 * 文件变更摘要（取舍 16）：轮内 write/edit 节点 resultMeta 的 ±行数按路径聚合，
 * 不聚合 pending diff（确认/回滚后清空、重载以服务器为准，直接聚合会丢已确认轮摘要）。
 * 同文件多次编辑行数累加。
 */
const fileChanges = computed(() => {
  const byPath = new Map<string, { path: string; additions: number; deletions: number }>()
  const collect = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === 'group') {
        collect(n.children)
        continue
      }
      if (n.type === 'tool.write' || n.type === 'tool.edit') {
        // result_meta 无统计时（历史轮旧事件）从节点 diff 现算兜底
        let add = n.additions || 0
        let del = n.deletions || 0
        if (!add && !del && n.diff) {
          const counted = countDiffLines(n.diff)
          add = counted.add
          del = counted.del
        }
        const prev = byPath.get(n.filePath) || { path: n.filePath, additions: 0, deletions: 0 }
        prev.additions += add
        prev.deletions += del
        byPath.set(n.filePath, prev)
      }
    }
  }
  collect(allNodes.value)
  return [...byPath.values()]
})

/** unified diff ± 行数统计：+ / - 开头行（排除 +++ / --- 文件头） */
function countDiffLines(diff: string): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) add++
    else if (line.startsWith('-')) del++
  }
  return { add, del }
}

// ── 操作与事件 ─────────────────────────────────────────────────────────────

/** 答案节点操作（复制/朗读/下载/保存/原文切换）——树外渲染，直接走分派器 */
function onAnswerAction(node: TreeNode, id: NodeActionId): void {
  void dispatch(node, id)
}

// ── 残余消息默认分支的简易 markdown 渲染 ──────────────────────────────────

function formatContent(content: string): string {
  if (!content) return ''
  return content
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}
</script>

<template>
  <div class="chat-round">
    <!-- 轮头：user 消息（回退/删除/复制） -->
    <RoundHeader
      v-if="round.userMessage"
      :message="round.userMessage"
      @undo-round="(id: number, content?: string) => emit('undo-round', id, content)"
    />

    <!-- 过程树：Agent 行常驻作树根（可随时收拢/展开，不消失），树在行下方 -->
    <div v-if="processNodes.length" class="agent-row" @click="treeCollapsed = !treeCollapsed">
      <img
        v-if="agentIdentity?.icon"
        class="agent-avatar"
        :class="{ executing: roundExecuting }"
        :src="agentIdentity.icon"
        alt=""
      />
      <span v-else class="agent-avatar agent-avatar-fallback" :class="{ executing: roundExecuting }">{{
        agentInitial
      }}</span>
      <span class="agent-name">{{ agentPrimaryName }}</span>
      <span v-if="agentRoleText" class="agent-role">{{ agentRoleText }}</span>
      <span v-if="roundDurationMs" class="agent-duration">任务耗时 {{ formatDuration(roundDurationMs) }}</span>
      <span class="flex-spacer" />
      <MxIcon
        name="lucide:chevron-right"
        :size="16"
        class="agent-chevron"
        :class="{ expanded: !treeCollapsed }"
      />
    </div>
    <TreeView
      v-if="!treeCollapsed && processNodes.length"
      :nodes="processNodes"
      :round-executing="roundExecuting"
      @error-retry="(id: string) => emit('retry', id)"
      @error-dismiss="(id: string) => emit('dismiss', id)"
      @open-settings="emit('open-settings')"
    />

    <!-- 最终答案：树外常显不折叠（§3.6），操作组平移自现役 ResultView -->
    <NodeCard
      v-for="ans in answerNodes"
      :key="ans.id"
      :node="ans"
      standalone
      @action="onAnswerAction"
    />

    <!-- 轮 footer：文件变更摘要 | 用量统计（Context ring 已前移至输入区 ContextUsageGauge） -->
    <RoundFooter :file-changes="fileChanges" :usage="footerUsage" :round-duration-ms="roundDurationMs" />

    <!-- 残余消息：builder 无法归入节点类型的系统杂项，默认分支兜底（审计不丢内容） -->
    <template v-for="m in residualMessages" :key="m.id">
      <div class="system-message">
        <div class="body">
          <h5 v-if="m.eventTitle" class="title">{{ m.eventTitle }}</h5>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="content" v-html="formatContent(m.content)"></div>
          <div class="event-data" v-if="m.eventData && Object.keys(m.eventData).length > 0">
            <pre><code>{{ JSON.stringify(m.eventData, null, 2) }}</code></pre>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chat-round {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  min-width: 0;
}

/* ── Agent 行：树的常驻根行，点击双向收拢/展开（§3.6 顶层布局） ── */
.agent-row {
  display: flex;
  margin-left: -10px;
  align-items: center;
  gap: var(--mx-space-2);
  /* 左缘贴树导轨线：头像与下方节点边线垂直对齐（右/上下间距保留） */
  padding: var(--mx-space-1) var(--mx-space-2) var(--mx-space-1) 0;
  cursor: pointer;
  user-select: none;
}

/* 轮头头像：圆形 20px（icon 优先，首字兜底）；执行中呼吸（与侧栏运行态同语义） */
.agent-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.agent-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  background: var(--mx-hover);
}

.agent-avatar.executing {
  animation: agent-dot-pulse 1.4s ease-in-out infinite;
}

@keyframes agent-dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.agent-name {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
}

.agent-role {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.agent-duration {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
}

.flex-spacer {
  flex: 1;
  min-width: 0;
}

.agent-chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.agent-chevron.expanded {
  transform: rotate(90deg);
}

/* ── 残余消息（默认分支兜底） ── */
.system-message {
  display: flex;
  gap: var(--mx-space-3);
}

.body {
  flex: 1;
  min-width: 0;
}

.title {
  font: var(--mx-font-body);
  font-weight: 700;
  color: var(--mx-text);
  margin-bottom: var(--mx-space-2);
}

.system-message .content {
  font: var(--mx-font-body);
  line-height: 1.7;
  color: var(--mx-text-secondary);
}

.system-message .content :deep(.inline-code) {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
  color: var(--mx-accent);
  padding: 2px var(--mx-space-1);
  border-radius: var(--mx-radius-control);
}

.system-message .content :deep(.code-block) {
  background: var(--mx-bg-surface);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-3);
  margin: var(--mx-space-2) 0;
  overflow-x: auto;
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-accent);
}

.event-data {
  margin-top: var(--mx-space-3);
}

.event-data pre {
  margin: 0;
  background: var(--mx-bg-surface);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  padding: var(--mx-space-3);
  max-height: 200px;
  overflow-y: auto;
  font: var(--mx-font-micro);
  font-family: var(--mx-font-mono);
  line-height: 1.5;
  color: var(--mx-accent);
}
</style>
