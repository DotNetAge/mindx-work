<script setup lang="ts">
// subagent 节点视图（树内轻量实现，全卡直渲形态）：「子代理」轻量行 + 内联直播子树，无卡片壳。
// 源：mindx-desktop tree/nodes/subagent/SubagentNodeView.vue（二期 B 平移）。
// - 行头：任务 · agent 角色 + 状态词（执行中流光）+ 步数摘要 + chevron，点击切换折叠；
// - 正文：taskDigest 平铺 + children 嵌套节点（工作块 E 内联直播：子代理的思考/
//   工具调用/阻塞/完成事件经树构建器归一化为嵌套节点，执行中默认展开跟随，
//   完成后折叠为「共 N 步」摘要）+ resultDigest markdown（子代理全过程经
//   「打开子会话」操作回看，按钮内联于行尾（外部链接图标），事件经 NodeCard 上抛分派）；
// - 折叠策略：执行中默认展开直播，完成自动收回（用户手动开合过则尊重用户选择）。
import { computed, reactive, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useMarkdown } from '../../../markdown'
import { agentRoleOf, formatDuration } from '../../../toolViewUtils'
import { AGENTS_ROLE_SOURCE } from '../../registry/summary'
import TreeNodeItem from '../../shell/TreeNodeItem.vue'
import type { SubagentNode } from '../../types/entity'
import type { TreeNode } from '../../types'

const props = defineProps<{ node: SubagentNode }>()

const emit = defineEmits<{ (e: 'open-subsession'): void }>()

const { md } = useMarkdown()

// 折叠状态：执行中默认展开（直播子代理全过程），完成自动收回；用户手动开合后接管
const expanded = ref(props.node.status === 'executing')
const userToggled = ref(false)

watch(() => props.node.status, (s) => {
  if (!userToggled.value && s !== 'executing') expanded.value = false
})

function toggle(): void {
  userToggled.value = true
  expanded.value = !expanded.value
}

const statusText = computed(() => {
  if (props.node.status === 'executing') return '执行中'
  if (props.node.status === 'success') return '已完成'
  if (props.node.status === 'failed') return '失败'
  return ''
})

const durationText = computed(() =>
  props.node.durationMs ? formatDuration(props.node.durationMs) : ''
)

// 步数摘要：children 归一化节点数（执行中实时增长，完成后折叠时显示「共 N 步」）
const stepsText = computed(() => {
  const n = props.node.children?.length || 0
  return n > 0 ? `共 ${n} 步` : ''
})

// 行面显示 Agent 角色（role_zh 中文名），原名仅作兜底（未招募/历史遗留）；
// 角色查询数据源为 registry/summary 的 AGENTS_ROLE_SOURCE（四期接 agents 服务）
const agentDisplay = computed(() => agentRoleOf(props.node.agentName, AGENTS_ROLE_SOURCE))

const resultHtml = computed(() =>
  props.node.resultDigest ? md.render(props.node.resultDigest) : ''
)

// ── children 顶层节点展开态：局部 Map（foldDefault 为初值，用户开合后接管）──
const childOverrides = reactive(new Map<string, boolean>())

function childExpandedOf(child: TreeNode): boolean {
  return childOverrides.get(child.id) ?? !child.foldDefault
}

function toggleChild(child: TreeNode): void {
  childOverrides.set(child.id, !childExpandedOf(child))
}
</script>

<template>
  <div class="subagent-view">
    <div class="subagent-row" @click="toggle">
      <MxIcon name="lucide:bot" :size="16" class="agent-icon" />
      <span class="agent-label">任务</span>
      <span class="agent-name">{{ agentDisplay }}</span>
      <span
        v-if="statusText"
        class="agent-status"
        :class="[node.status, { 'shimmer-text': node.status === 'executing' }]"
      >{{ statusText }}</span>
      <span v-if="node.restored" class="agent-restored">已恢复</span>
      <span v-if="durationText" class="agent-duration">{{ durationText }}</span>
      <span class="flex-spacer" />
      <!-- 打开子会话：内联常驻（外部链接图标），弱色不争注意力；阻断行点击折叠 -->
      <el-tooltip v-if="node.sessionId" content="打开子会话" placement="top" :hide-after="0">
        <button class="subsession-btn" aria-label="打开子会话" @click.stop="emit('open-subsession')">
          <MxIcon name="lucide:arrow-up-right" :size="16" />
        </button>
      </el-tooltip>
      <span v-if="stepsText" class="agent-steps">{{ stepsText }}</span>
      <MxIcon
        name="lucide:arrow-right"
        :size="16"
        class="agent-chevron"
        :class="{ open: expanded }"
      />
    </div>
    <!-- 正文平铺：任务摘要灰字 + 内联直播子树 + 结果 markdown（无容器框）；
         ElCollapseTransition 承载高度动效 -->
    <el-collapse-transition>
      <div v-if="expanded" class="subagent-body">
        <div v-if="node.taskDigest" class="task-digest">{{ node.taskDigest }}</div>
        <!-- 内联直播子树：经 TreeNodeItem 递归渲染（group/全卡直渲/统一名片同树壳） -->
        <div v-if="node.children?.length" class="subagent-children">
          <TreeNodeItem
            v-for="child in node.children"
            :key="child.id"
            :node="child"
            :expanded="childExpandedOf(child)"
            @toggle="toggleChild(child)"
          />
        </div>
        <!-- eslint-disable-next-line vue/no-v-html —— 结果摘要经 useMarkdown 渲染（内部含 DOMPurify 消毒） -->
        <div v-if="resultHtml" class="result-digest markdown-body" v-html="resultHtml"></div>
      </div>
    </el-collapse-transition>
  </div>
</template>

<style scoped>
.subagent-view {
  min-width: 0;
}

/* ── 子代理行：轻量行，无背景无边框（去卡片化） ── */
.subagent-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-height: 28px;
  padding: 2px var(--mx-space-2) 2px 0;
  cursor: pointer;
  user-select: none;
}

.agent-icon {
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.agent-label {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}

.agent-name {
  font: var(--mx-font-caption);
  color: var(--mx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-status {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.agent-status.success {
  /* 完成不是高亮事件：走中性第二色（树内成功态统一灰） */
  color: var(--mx-text-secondary);
}

.agent-status.failed {
  color: var(--mx-danger);
}

.agent-restored {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.agent-duration {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
  /* 行面只留 图标+动词+宾语，时长 hover 行时才显现 */
  opacity: 0;
  transition: opacity 0.15s ease;
}

.subagent-row:hover .agent-duration {
  opacity: 1;
}

.flex-spacer {
  flex: 1;
  min-width: 0;
}

/* 步数摘要：完成折叠后的轻量信息（不打断去卡片化行面） */
.agent-steps {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}

/* 打开子会话按钮：内联常驻弱色（同 NodeCard 内联操作语义），hover 提亮 */
.subsession-btn {
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
  flex-shrink: 0;
}

.subsession-btn:hover {
  color: var(--mx-text);
}

.agent-chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.agent-chevron.open {
  transform: rotate(90deg);
}

/* ── 正文：直接平铺，无容器框；1px 左侧竖直引导线贯穿整个展开区 ── */
.subagent-body {
  margin: var(--mx-space-1) 0 var(--mx-space-2) var(--mx-space-2);
  padding: var(--mx-space-1) 0 var(--mx-space-1) var(--mx-space-3);
  border-left: 1px solid color-mix(in srgb, var(--mx-text-tertiary) 26%, transparent);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.task-digest {
  font: var(--mx-font-caption);
  line-height: 1.7;
  color: var(--mx-text-secondary);
  word-break: break-word;
  white-space: pre-wrap;
}

/* 内联直播子树：与树壳成员区同款缩进导轨（TreeNodeItem 自带 1px 引导线） */
.subagent-children {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  min-width: 0;
}

.result-digest {
  font: var(--mx-font-caption);
  line-height: 1.7;
  color: var(--mx-text-secondary);
  word-break: break-word;
}
</style>
