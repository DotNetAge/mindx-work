<script setup lang="ts">
/** Detail 住户：轨道内容自绘；ViewProps.active 由壳传入（界面事实，非业务数据） */
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'

const props = defineProps<{ active?: boolean }>()
const shell = useShell()

const facts = [
  { label: '轨道状态', value: '呈现中' },
  { label: 'tab 归属', value: '多插件共存，互不抢位' },
  { label: '几何让位', value: '由壳计算，住户不自算边界' },
]
</script>

<template>
  <div :class="$style.detail">
    <div :class="$style.head">
      <MxIcon name="lucide:info" :size="16" />
      <h2 :class="$style.heading">详情轨道</h2>
      <span :class="$style.state" :data-active="props.active ? 'true' : 'false'">
        {{ props.active ? '呈现中' : '隐藏' }}
      </span>
    </div>

    <dl :class="$style.facts">
      <div v-for="fact in facts" :key="fact.label" :class="$style.fact">
        <dt :class="$style.factLabel">{{ fact.label }}</dt>
        <dd :class="$style.factValue">{{ fact.value }}</dd>
      </div>
    </dl>

    <p :class="$style.caption">Detail 是轨道：决定 Content 让位，住户自绘内容。</p>

    <button type="button" class="mx-btn" @click="shell.Detail.hide()">收起轨道</button>
  </div>
</template>

<style module>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  color: var(--mx-text-secondary);
}

.heading {
  font: var(--mx-font-heading);
  color: var(--mx-text);
  margin: 0;
  flex: 1;
}

.state {
  font: var(--mx-font-micro);
  color: var(--mx-text-on-accent);
  background: var(--mx-success);
  border-radius: 999px;
  padding: 1px 8px;
}

.state[data-active='false'] {
  background: var(--mx-text-tertiary);
}

.facts {
  margin: 0;
  display: flex;
  flex-direction: column;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--mx-space-2) 0;
}

.fact + .fact {
  border-top: 1px solid var(--mx-separator);
}

.factLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.factValue {
  font: var(--mx-font-body);
  color: var(--mx-text);
  margin: 0;
}

.caption {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  margin: 0;
}
</style>
