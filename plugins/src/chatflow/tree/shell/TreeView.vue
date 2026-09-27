<script setup lang="ts">
// TreeView —— 树壳（PR §3.1，完全通用）：DFS 渲染 + 缩进竖线导轨 + 覆盖 Map 折叠
// + gap 标记（30s 阈值）+ 树尾 pending 行。壳不认识任何具体工具类型，
// 类型差异全部经 registry（presentationOf / actionsOf / viewOf / groupHeaderOf）消费。
//
// - 渲染器选型（取舍 17）：自研递归渲染器，不采用 el-tree；树深 ≤2
//   （group 成员必为工具节点、subagent 一阶段全卡无子树），两层渲染即可表达；
// - 折叠即策略：执行中只自动展开「根 → 当前活跃节点」路径（useActivePath 集合），
//   执行完成（离开活跃集合）自动收回折叠；用户手动开合落在覆盖 Map（取舍 15），优先级高于
//   自动策略——手动收起的节点不被自动展开顶回，手动展开的节点不被完成收回压下；
// - 折叠动效：统一走 ElCollapseTransition 高度过渡（组员容器与名片正文同一动效语言）；
// - 惰性挂载：group 展开才构建成员 DOM、名片展开才构建视图 DOM（v-if）；
// - gap 标记（§3.5 缺口层）：相邻节点 startedAt 差值超阈值时渲染 ephemeral
//   「暂停 Xs」标记——时间差是派生态，不入树数据；
// - 树尾 pending 行（§3.4）：轮 executing 但当前无 executing 节点（LLM 建流空窗）；
// - 自动滚动跟随活跃节点。
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import PendingRow from './PendingRow.vue'
import TreeNodeItem from './TreeNodeItem.vue'
import { useActivePath } from './useActivePath'
import { CONTENT_EXECUTING_LABEL } from '../registry/summary'
import type { TreeNode } from '../types'
import { isGroupNode } from '../types'
import { formatDuration } from '../../toolViewUtils'
import '../styles/shimmer.css'

/** gap 标记阈值（PR §3.5 建议 30s）：揭示 LLM 重试等待、授权挂起、压缩卡顿等停顿 */
const GAP_THRESHOLD_MS = 30_000

const props = defineProps<{
  /** 本轮节点树（builder 产出） */
  nodes: TreeNode[]
  /** 轮是否执行中：驱动树尾 pending 行（无 executing 节点时显示建流空窗） */
  roundExecuting?: boolean
}>()

const emit = defineEmits<{
  (e: 'error-retry', messageId: string): void
  (e: 'error-dismiss', messageId: string): void
  (e: 'open-settings'): void
}>()

// ── 折叠 UI 态：覆盖 Map（nodeId → expanded），foldDefault 为初值（取舍 15）──

const overrides = reactive(new Map<string, boolean>())

/** 壳自动展开的节点集合：执行完成时若用户未手动接管，自动收回（回落 foldDefault 折叠） */
const autoExpanded = new Set<string>()

function expandedOf(node: TreeNode): boolean {
  return overrides.get(node.id) ?? !node.foldDefault
}

function toggleExpand(node: TreeNode): void {
  // 用户手动开合即接管该节点折叠态，自动策略（展开/完成收回）此后不再干预
  autoExpanded.delete(node.id)
  overrides.set(node.id, !expandedOf(node))
}

// ── 活跃路径：新进入活跃集合的节点自动展开（覆盖 Map 写 true），滚动跟随；
//    离开活跃集合（执行完成/取消）时若为壳自动展开且用户未接管，自动收回折叠 ──

const { activeIds } = useActivePath(computed(() => props.nodes))
const rootRef = ref<HTMLElement | null>(null)

watch(activeIds, (ids, prev) => {
  // 结算离开活跃集合的节点：仅收回壳自己展开的，用户接管的不动
  if (prev) {
    for (const id of prev) {
      if (!ids.has(id) && autoExpanded.has(id)) {
        autoExpanded.delete(id)
        overrides.delete(id)
      }
    }
  }
  let newest = ''
  for (const id of ids) {
    if (!prev?.has(id)) {
      overrides.set(id, true)
      autoExpanded.add(id)
      newest = id
    }
  }
  if (!newest) return
  void nextTick(() => {
    rootRef.value
      ?.querySelector(`[data-node-id="${newest}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
})

// ── 树尾 pending 行（§3.4）：轮 executing 但无任何 executing 节点 ──────────

const hasExecutingNode = computed(() =>
  props.nodes.some(n =>
    n.status === 'executing' ||
    (isGroupNode(n) && n.children.some(c => c.status === 'executing'))
  )
)

const pendingVisible = computed(() => !!props.roundExecuting && !hasExecutingNode.value)

// ── gap 标记（缺口层，§3.5）：相邻节点时间差超阈值 → ephemeral 标记行 ──────

function gapMsBefore(list: TreeNode[], index: number): number {
  if (index <= 0) return 0
  const prev = list[index - 1]!
  const prevEnd = prev.startedAt + (prev.durationMs ?? 0)
  return Math.max(0, list[index]!.startedAt - prevEnd)
}
</script>

<template>
  <div ref="rootRef" class="tree-view show-file-icons">
    <template v-for="(node, i) in nodes" :key="node.id">
      <!-- gap 标记（ephemeral，不入树数据） -->
      <div v-if="gapMsBefore(nodes, i) > GAP_THRESHOLD_MS" class="gap-mark">
        <MxIcon name="lucide:circle-pause" :size="16" />
        <span>暂停 {{ formatDuration(gapMsBefore(nodes, i)) }}</span>
      </div>

      <!-- 节点渲染统一收敛到 TreeNodeItem（group/全卡直渲/统一名片三分支，
           与 SubagentNodeView 的 children 嵌套区共用同一渲染路径） -->
      <TreeNodeItem
        :node="node"
        :expanded="expandedOf(node)"
        @toggle="toggleExpand(node)"
        @error-retry="(mid) => emit('error-retry', mid)"
        @error-dismiss="(mid) => emit('error-dismiss', mid)"
        @open-settings="emit('open-settings')"
      />
    </template>

    <!-- 树尾 pending 行：LLM 建流空窗（§3.4），轮结束消失 -->
    <PendingRow v-if="pendingVisible" :label="CONTENT_EXECUTING_LABEL" />
  </div>
</template>

<style scoped>
.tree-view {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ── gap 标记：ephemeral 停顿提示（§3.5 缺口层） ── */
.gap-mark {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  padding: 1px 0 1px var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-style: italic;
}
</style>
