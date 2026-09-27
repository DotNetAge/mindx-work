<script setup lang="ts">
// tool.skill 节点展开态：SKILL.md 预览（FormattedContent 渲染，PR 对照表）。
// 技能说明文本 = outputTail（Skill 工具返回的 SKILL.md 内容/摘要）；
// 「查看 SKILL.md」操作（open-skill-doc）走名片操作分派。
import { computed } from 'vue'
import FormattedContent from '../../../chatround/FormattedContent.vue'
import type { SkillToolNode } from '../../types/tool'

const props = defineProps<{ node: SkillToolNode }>()

const docText = computed(() => props.node.outputTail || '')
</script>

<template>
  <div class="skill-detail">
    <el-tooltip v-if="node.rootDir" :content="node.rootDir" placement="top" :hide-after="0">
      <div class="detail-dir">{{ node.rootDir }}</div>
    </el-tooltip>
    <FormattedContent v-if="docText" :content="docText" />
    <div v-else class="detail-empty">技能说明不可用</div>
  </div>
</template>

<style scoped>
.skill-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-1) 0;
}

.detail-dir {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
