<script setup lang="ts">
/**
 * banner 内容组件：壳容器提供卡片壳与关闭钮，本组件只写图标与文案排版。
 * 插件间禁止 import，本文件为 connectors 插件自带副本（范式同 models）。
 */
import { MxIcon } from '@mindx-work/ui-shell-vue'

defineProps<{ tone: 'success' | 'error' | 'warning'; text: string }>()
</script>

<template>
  <div :class="$style.banner">
    <span :class="$style.iconCol" :data-tone="tone">
      <MxIcon
        :name="tone === 'success' ? 'lucide:circle-check' : tone === 'warning' ? 'lucide:triangle-alert' : 'lucide:circle-alert'"
        :size="16"
      />
    </span>
    <span :class="$style.text">{{ text }}</span>
  </div>
</template>

<style module>
.banner {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  color: var(--mx-text);
}

/* 图标按色调着色，文案保持主墨色 */
.iconCol {
  display: inline-flex;
  color: var(--mx-state-success);
}

.iconCol[data-tone='error'] {
  color: var(--mx-state-error);
}

.iconCol[data-tone='warning'] {
  color: var(--mx-state-warn-label);
}

.text {
  min-width: 0;
}
</style>
