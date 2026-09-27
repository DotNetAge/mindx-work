<script setup lang="ts">
// thinking 节点视图（树内轻量实现，源：mindx-desktop tree/nodes/thinking）：
// 「思考」轻量行 + 正文平铺，无卡片壳。
// 不复用现役 ThinkingView（其边框卡片样式不符树内去卡片化规范）：
// - 行头：图标 + 思考/思考中（executing 流光）+ 时长（hover 显现）+ chevron，点击切换折叠；
// - 正文：思想流形态（轻描边圆角容器平铺），useMarkdown 渲染（内部含 DOMPurify 消毒），
//   executing 默认展开直播，执行完成自动收回折叠（用户手动开合过则尊重用户选择）。
import { computed, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useMarkdown } from '../../../markdown'
import { formatDuration } from '../../../toolViewUtils'
import type { ThinkingNode } from '../../types/content'

const props = defineProps<{ node: ThinkingNode }>()

const { md } = useMarkdown()

// 折叠状态：执行中默认展开（直播推理流），完成自动收回；用户手动开合后接管
const expanded = ref(props.node.status === 'executing')
const userToggled = ref(false)

watch(() => props.node.status, (s) => {
  if (!userToggled.value && s !== 'executing') expanded.value = false
})

function toggle(): void {
  userToggled.value = true
  expanded.value = !expanded.value
}

const bodyHtml = computed(() => (props.node.content ? md.render(props.node.content) : ''))
const durationText = computed(() =>
  props.node.durationMs ? formatDuration(props.node.durationMs) : ''
)
</script>

<template>
  <div class="thinking-view">
    <div class="think-row" @click="toggle">
      <MxIcon name="lucide:lightbulb" :size="16" class="think-icon" />
      <span class="think-verb" :class="{ 'shimmer-text': node.status === 'executing' }">
        {{ node.status === 'executing' ? '思考中' : '思考' }}
      </span>
      <span v-if="durationText" class="think-duration">{{ durationText }}</span>
      <span class="flex-spacer" />
      <MxIcon
        name="lucide:chevron-right"
        :size="16"
        class="think-chevron"
        :class="{ open: expanded }"
      />
    </div>
    <!-- 正文平铺：经 useMarkdown 渲染（内部含 DOMPurify 消毒）；ElCollapseTransition 承载高度动效 -->
    <el-collapse-transition>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-if="expanded && bodyHtml" class="think-body markdown-body" v-html="bodyHtml"></div>
    </el-collapse-transition>
  </div>
</template>

<style scoped>
.thinking-view {
  min-width: 0;
}

/* ── 思考行：轻量行，无背景无边框（去卡片化） ── */
.think-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-height: 28px;
  padding: 2px var(--mx-space-2) 2px 0;
  cursor: pointer;
  user-select: none;
}

.think-icon {
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.think-verb {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}

.think-duration {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  /* 行面只留 图标+动词，时长 hover 行时才显现 */
  opacity: 0;
  transition: opacity 0.15s ease;
}

.think-row:hover .think-duration {
  opacity: 1;
}

.flex-spacer {
  flex: 1;
  min-width: 0;
}

.think-chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.think-chevron.open {
  transform: rotate(90deg);
}

/* ── 正文：思想流形态——轻描边圆角容器平铺（参考形态），弱背景填充，
     内边距四向一致；文字颜色与正文一致 ── */
.think-body {
  margin: var(--mx-space-1) 0 var(--mx-space-2);
  padding: var(--mx-space-3);
  border: 1px solid color-mix(in srgb, var(--mx-text-tertiary) 22%, transparent);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-text-tertiary) 8%, transparent);
  font: var(--mx-font-caption);
  line-height: 1.7;
  color: var(--mx-text);
  word-break: break-word;
}
</style>
