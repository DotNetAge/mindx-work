<script setup lang="ts">
/** demo banner：纯内容组件，关闭按钮由壳容器提供（关闭 = 移除条目） */
import { MxIcon } from '@mindx-work/ui-shell-vue'
</script>

<template>
  <div :class="$style.banner">
    <MxIcon name="lucide:bell" :size="16" />
    <span>示例通知：浮层编排正常</span>
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
</style>
