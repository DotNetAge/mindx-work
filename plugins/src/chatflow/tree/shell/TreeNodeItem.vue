<script setup lang="ts">
// TreeNodeItem —— 树节点通用渲染项：单节点三分支（group 递归 / 全卡直渲 / 统一名片）。
// 抽取自 TreeView 顶层分支模板，供树壳与 SubagentNodeView 的 children 嵌套区复用
// （工作块 E：子代理全过程内联直播节点挂在 subagent 节点 children 上，经此递归渲染）。
//
// - 折叠状态完全受控：顶层节点的 expanded 由使用方传入（树壳的覆盖 Map /
//   SubagentNodeView 的局部 Map）；group 成员的展开态在本组件内部以局部 Map 管理
//   （foldDefault 为初值，用户开合后接管）；
// - 操作分派：非 error 节点走 useNodeActions 统一分派（打开子会话/编辑器等）；
//   error 节点的 retry/dismiss/open-settings 链路依赖 ChatRound 的原始消息上下文，
//   原样上抛由使用方决定是否承接（children 内的 error 上抛无人承接时静默）。
import { computed, reactive } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import NodeCard from './NodeCard.vue'
import { groupHeaderOf } from '../registry/summary'
import { viewOf } from '../registry/components'
import { useNodeActions } from './useNodeActions'
import { formatDuration } from '../../toolViewUtils'
import type { NodeActionId } from '../registry/actions'
import type { TreeNode } from '../types'
import { isGroupNode } from '../types'

const props = defineProps<{
  /** 受控展开态：统一名片与 group 头形态消费（全卡直渲视图自管折叠） */
  expanded?: boolean
  node: TreeNode
}>()

const emit = defineEmits<{
  (e: 'action', node: TreeNode, id: NodeActionId): void
  (e: 'error-retry', messageId: string): void
  (e: 'error-dismiss', messageId: string): void
  (e: 'open-settings'): void
  (e: 'toggle'): void
}>()

const { dispatch, errorMessageId } = useNodeActions()

/** 全卡直渲判定：registry/components.ts 的 standalone 标记（content/thinking/subagent） */
const isStandalone = computed(() => !!viewOf(props.node)?.standalone)

const header = computed(() => (isGroupNode(props.node) ? groupHeaderOf(props.node) : null))

// ── group 成员展开态：局部 Map（foldDefault 为初值，开合即接管） ──
const childOverrides = reactive(new Map<string, boolean>())

function childExpandedOf(child: TreeNode): boolean {
  return childOverrides.get(child.id) ?? !child.foldDefault
}

function toggleChild(child: TreeNode): void {
  childOverrides.set(child.id, !childExpandedOf(child))
}

// ── 操作分派：error 三操作上抛（ChatRound 承接重试链路），其余走分派器 ──

function onAction(node: TreeNode, id: NodeActionId): void {
  if (node.type === 'error') {
    const mid = errorMessageId(node)
    if (id === 'retry') emit('error-retry', mid)
    else if (id === 'ignore') emit('error-dismiss', mid)
    else if (id === 'open-settings') emit('open-settings')
    return
  }
  void dispatch(node, id)
}
</script>

<template>
  <div class="tree-node-item" :data-node-id="node.id">
    <!-- group：组头（受控展开）+ 成员递归 -->
    <template v-if="isGroupNode(node)">
      <div class="group-row" :class="node.status" @click="emit('toggle')">
        <MxIcon :name="header!.icon" :size="16" class="group-icon" />
        <span class="group-text">{{ header!.text }}</span>
        <span class="flex-spacer" />
        <span v-if="node.durationMs" class="badge duration">{{ formatDuration(node.durationMs) }}</span>
        <MxIcon name="lucide:chevron-right" :size="16" class="chevron" :class="{ open: expanded }" />
      </div>
      <el-collapse-transition>
        <div v-if="expanded" class="group-children">
          <TreeNodeItem
            v-for="child in node.children"
            :key="child.id"
            :node="child"
            :expanded="childExpandedOf(child)"
            @toggle="toggleChild(child)"
            @action="(n, id) => emit('action', n, id)"
            @error-retry="(mid) => emit('error-retry', mid)"
            @error-dismiss="(mid) => emit('error-dismiss', mid)"
            @open-settings="emit('open-settings')"
          />
        </div>
      </el-collapse-transition>
    </template>

    <!-- 全卡直渲（content/thinking/subagent） -->
    <NodeCard
      v-else-if="isStandalone"
      :node="node"
      standalone
      @action="onAction"
    />

    <!-- 统一名片（其余类型） -->
    <NodeCard
      v-else
      :node="node"
      :expanded="expanded"
      @action="onAction"
      @toggle="emit('toggle')"
    />
  </div>
</template>

<style scoped>
.tree-node-item {
  position: relative;
  min-width: 0;
  /* 导轨线留位：与树壳顶层节点同款缩进 */
  padding-left: var(--mx-space-3);
}

/* 节点导轨：1px 竖直引导线贯穿节点（与树壳 .tree-node::before 同款） */
.tree-node-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: -2px;
  width: 1px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--mx-text-tertiary) 26%, transparent);
}

/* ── group 组头：轻量行，无背景无边框（去卡片化） ── */
.group-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-height: 28px;
  padding: 2px var(--mx-space-2) 2px 0;
  cursor: pointer;
}

.group-icon {
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.group-text {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  min-width: 0;
}

.flex-spacer {
  flex: 1;
  min-width: 0;
}

.badge.duration {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-family: var(--mx-font-mono);
}

/* 成员缩进竖线导轨：与顶层节点导轨同色 */
.group-children {
  margin-left: var(--mx-space-2);
  padding-left: var(--mx-space-3);
  border-left: 1px solid color-mix(in srgb, var(--mx-text-tertiary) 26%, transparent);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.chevron.open {
  transform: rotate(90deg);
}
</style>
