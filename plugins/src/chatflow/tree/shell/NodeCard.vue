<script setup lang="ts">
// NodeCard —— 统一名片（PR §3.3 / §3.5 / §3.6）。
//
// 两种渲染形态（由 registry/components.ts 的 standalone 标记分流）：
// - 全卡直渲：视图自带 header/折叠/正文（content/thinking/subagent），
//   本组件只补底部操作行（registry/actions.ts 声明）与视图 expose 方法承接；
// - 统一名片：`图标 + 状态动词 + 对象 + 元信息徽标` 唯一新增样式语言，
//   点击切换展开（展开态视图由 <component :is> 经注册表分派，惰性挂载）。
//
// 名片横切关注点全部收在此处，各类型只经 registry 消费（树壳零特判）：
// - 状态着色：executing 流光文案（§3.4）/ success 中性第二色（成功不是高亮事件，全灰）/
//   attention 黄（静态 attention 类型 + 超阈值慢节点）/ failed 红（§3.6）；
// - 时长徽标阈值化（§3.5）：超 2s 才显示、hover 行时显现 + tooltip 显示精确 startedAt + duration；
// - 审批徽标：NodeBase.approval 的留痕着色（granted/session-granted/denied）。
import { computed, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { actionsOf, type NodeActionId } from '../registry/actions'
import { presentationOf, resolveText } from '../registry/summary'
import { viewOf } from '../registry/components'
import LangBadge from '../nodes/shared/LangBadge.vue'
import type { TreeNode } from '../types'
import { formatDuration } from '../../toolViewUtils'
import '../styles/shimmer.css'

/** 时长徽标显示阈值（PR §3.5 建议 2s）：正常速度不显示，时间是异常信号不是常规标签 */
const DURATION_BADGE_MS = 2_000
/** 慢节点黄灯阈值（PR §3.6「超阈值慢节点」）：成功但耗时异常的节点着 attention 黄 */
const SLOW_NODE_MS = 30_000

const props = defineProps<{
  node: TreeNode
  /** 全卡直渲形态：视图自成一体，无统一名片容器 */
  standalone?: boolean
  /** 展开态（受控，覆盖 Map 由树壳持有，PR 取舍 15）：仅统一名片形态消费 */
  expanded?: boolean
}>()

const emit = defineEmits<{
  (e: 'action', node: TreeNode, id: NodeActionId): void
  (e: 'toggle'): void
}>()

// ── 注册表查询 ─────────────────────────────────────────────────────────────

const entry = computed(() => viewOf(props.node))
const pres = computed(() => presentationOf(props.node))
/** 可展开判定：注册表有视图且非全卡直渲形态（sleep 等无展开态的类型 entry 为 null） */
const hasDetail = computed(() => !props.standalone && !!entry.value)

// ── 状态视觉（§3.6 四态） ──────────────────────────────────────────────────

const statusClass = computed(() => {
  const n = props.node
  if (n.status === 'executing') return 'executing'
  if (n.status === 'failed') return 'failed'
  // cancelled（用户中断）：非失败非成功，中性灰呈现，不套四色语义
  if (n.status === 'cancelled') return 'neutral'
  const slow = n.status === 'success' && (n.durationMs ?? 0) > SLOW_NODE_MS
  if (pres.value?.attention || slow) return 'attention'
  return 'success'
})

const isExecuting = computed(() => props.node.status === 'executing')

// ── 名片文案（§3.3：图标 + 状态动词 + 对象 + 徽标） ────────────────────────

const verbText = computed(() => {
  const p = pres.value
  if (!p) return ''
  return isExecuting.value ? resolveText(p.executing, props.node) : resolveText(p.verb, props.node)
})

const objectText = computed(() => pres.value?.object(props.node) ?? '')

/** 审批徽标文案（NodeBase.approval 留痕；denied 态由 failed 红色承载，不叠字） */
const approvalBadge = computed(() => {
  switch (props.node.approval) {
    case 'granted': return '已授权'
    case 'session-granted': return '会话内已授权'
    default: return ''
  }
})

const badges = computed(() => {
  const list = pres.value ? pres.value.badges(props.node).filter(Boolean) : []
  return approvalBadge.value ? [...list, approvalBadge.value] : list
})

/** 时长徽标（阈值化，§3.5）：超 2s 显示「4.2s」 */
const durationText = computed(() => {
  const d = props.node.durationMs
  return d != null && d > DURATION_BADGE_MS ? formatDuration(d) : ''
})

/** hover 提示：精确 startedAt（轮内偏移）+ duration */
const timeTooltip = computed(() => {
  if (!durationText.value) return ''
  const parts = [`T+${formatDuration(props.node.startedAt)}`]
  if (props.node.durationMs) parts.push(`耗时 ${formatDuration(props.node.durationMs)}`)
  return parts.join(' · ')
})

// ── 操作组（§4.1：registry 声明 → 此处渲染 → emit 分派） ──────────────────

const cardActions = computed(() => actionsOf(props.node))
/** 内联操作（registry 声明 inline）：常驻渲染于宾语之后（复制命令紧跟命令摘要） */
const inlineActions = computed(() => cardActions.value.filter(a => a.inline))
/** 行尾操作组：hover 名片时出现（不与常规阅读争夺注意力） */
const trailingActions = computed(() => cardActions.value.filter(a => !a.inline))

/** 全卡直渲视图实例：承接视图 expose 方法（content 的 speak） */
const viewRef = ref<{ speak?: () => void } | null>(null)

function runAction(id: NodeActionId): void {
  // content 答案形态的朗读是视图内部状态（isSpeaking），优先调 expose 方法
  if (props.node.type === 'content' && viewRef.value) {
    if (id === 'speak' && viewRef.value.speak) {
      viewRef.value.speak()
      return
    }
  }
  emit('action', props.node, id)
}

// 文件名可点击（在编辑器打开）：read 无展开态，文件名即入口（open-file-at 分派 openFileAt）
const linkedObject = computed(() => props.node.type === 'tool.read')

/** 展开态视图的阻断事件（ErrorNodeView retry/dismiss/open-settings）→ 统一 action 语义上抛 */
function onViewEvent(id: NodeActionId): void {
  emit('action', props.node, id)
}
</script>

<template>
  <!-- 全卡直渲形态 -->
  <div v-if="standalone" class="node-card standalone">
    <component
      :is="entry!.view"
      ref="viewRef"
      :node="node"
      @retry="onViewEvent('retry')"
      @dismiss="onViewEvent('ignore')"
      @open-settings="onViewEvent('open-settings')"
      @open-subsession="onViewEvent('open-subsession')"
    />
    <div v-if="cardActions.length" class="view-actions">
      <el-tooltip v-for="a in cardActions" :key="a.id" :content="a.label" placement="top" :hide-after="0">
        <button class="action-btn" :aria-label="a.label" @click="runAction(a.id)">
          <MxIcon v-if="a.icon" :name="a.icon" :size="16" class="action-icon" />
          <template v-else>{{ a.label }}</template>
        </button>
      </el-tooltip>
    </div>
  </div>

  <!-- 统一名片形态 -->
  <div v-else class="node-card" :class="[statusClass, { expanded }]">
    <div class="card-row" :class="{ clickable: hasDetail }" @click="hasDetail && emit('toggle')">
      <MxIcon :name="pres!.icon" :size="16" class="card-icon" />
      <span class="card-verb" :class="{ 'shimmer-text': isExecuting }">{{ verbText }}</span>
      <el-tooltip v-if="objectText" :content="objectText" placement="top" :hide-after="0">
        <span
          class="card-object"
          :class="{ linked: linkedObject }"
          @click.stop="linkedObject && runAction('open-file-at')"
        ><LangBadge v-if="linkedObject" :path="objectText" size="sm" class="object-icon" />{{ objectText }}</span>
      </el-tooltip>
      <!-- 内联操作：常驻（registry 声明 inline，如复制命令紧跟命令摘要） -->
      <span v-if="inlineActions.length" class="inline-actions" @click.stop>
        <el-tooltip v-for="a in inlineActions" :key="a.id" :content="a.label" placement="top" :hide-after="0">
          <button class="action-btn" :aria-label="a.label" @click="runAction(a.id)">
            <MxIcon v-if="a.icon" :name="a.icon" :size="16" class="action-icon" />
            <template v-else>{{ a.label }}</template>
          </button>
        </el-tooltip>
      </span>
      <span v-if="badges.length" class="card-badges">
        <span v-for="(b, i) in badges" :key="i" class="badge">{{ b }}</span>
      </span>
      <el-tooltip v-if="timeTooltip" :content="timeTooltip" placement="top">
        <span class="badge duration">{{ durationText }}</span>
      </el-tooltip>
      <span class="flex-spacer" />
      <span v-if="trailingActions.length" class="card-actions" @click.stop>
        <el-tooltip v-for="a in trailingActions" :key="a.id" :content="a.label" placement="top" :hide-after="0">
          <button class="action-btn" :aria-label="a.label" @click="runAction(a.id)">
            <MxIcon v-if="a.icon" :name="a.icon" :size="16" class="action-icon" />
            <template v-else>{{ a.label }}</template>
          </button>
        </el-tooltip>
      </span>
      <MxIcon v-if="hasDetail" name="lucide:chevron-right" :size="16" class="chevron" />
    </div>

    <!-- 展开态：视图经注册表分派，惰性挂载（展开才构建 DOM，§3.1）；ElCollapseTransition 承载高度动效 -->
    <el-collapse-transition>
      <div v-if="expanded && entry" class="card-body">
        <component
          :is="entry.view"
          :node="node"
          @retry="onViewEvent('retry')"
          @dismiss="onViewEvent('ignore')"
          @open-settings="onViewEvent('open-settings')"
          @open-diff="onViewEvent('open-diff')"
        />
      </div>
    </el-collapse-transition>
  </div>
</template>

<style scoped>
.node-card {
  position: relative;
}

/* ── 名片行：轻量行，无背景无边框（去卡片化） ── */
.card-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-height: 28px;
  padding: 2px var(--mx-space-2) 2px 0;
}

.card-row.clickable {
  cursor: pointer;
}

/* 状态图标着色：成功走中性第二色（成功不是高亮事件，参考形态全灰），异常态保留警示色 */
.card-icon {
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.attention .card-icon {
  color: var(--mx-warning);
}

.failed .card-icon {
  color: var(--mx-danger);
}

.executing .card-icon {
  color: var(--mx-accent);
}

/* 状态动词：executing 时走流光文案（shimmer-text 全局类） */
.card-verb {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}

.attention .card-verb {
  color: var(--mx-warning);
}

.failed .card-verb {
  color: var(--mx-danger);
}

/* 名片对象：精选主体，单行截断；树节点文字统一第二色（比正文暗） */
.card-object {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* 文件名可点击形态（read）：hover 下划线提示，点击在编辑器打开 */
.card-object.linked {
  cursor: pointer;
}

.card-object.linked:hover {
  text-decoration: underline;
}

/* 元信息徽标：±行数 / 命中数 / 状态词 */
.card-badges {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-shrink: 0;
}

/* 元信息徽标：纯文本弱色，不做色块（去卡片化） */
.badge {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
}

.badge.duration {
  color: var(--mx-text-secondary);
  font-family: var(--mx-font-mono);
}

.flex-spacer {
  flex: 1;
  min-width: 0;
}

/* 操作组：hover 名片时出现（不与常规阅读争夺注意力） */
.card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

/* 内联操作：常驻宾语之后（图 2 形态：复制命令紧跟命令摘要），弱色不争注意力 */
.inline-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.inline-actions .action-btn {
  color: var(--mx-text-tertiary);
}

.card-row:hover .card-actions,
.card-actions:focus-within {
  opacity: 1;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--mx-text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px;
  border-radius: var(--mx-radius-control);
  white-space: nowrap;
}

.action-btn:hover {
  color: var(--mx-text);
}

/* 答案形态操作行（view-actions）：水平 padding 翻倍——定宽 24px 改自适应，
   左右 2px→8px，图标视觉空隙每侧 4px→8px */
.view-actions .action-btn {
  width: auto;
  padding: 2px 8px;
}

.action-btn .action-icon {
  color: inherit;
}

/* ── 时长徽标：行内常隐，hover 行时才显现（参考形态：行面只留 图标+动词+宾语） ── */
.badge.duration {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.card-row:hover .badge.duration {
  opacity: 1;
}

/* 展开 chevron */
.chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.expanded .chevron {
  transform: rotate(90deg);
}

/* 展开态视图容器：与名片行保持左对齐层级 */
.card-body {
  padding: var(--mx-space-1) 0 var(--mx-space-2) var(--mx-space-4);
}
</style>
