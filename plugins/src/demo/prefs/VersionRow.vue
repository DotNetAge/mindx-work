<script setup lang="ts">
/** 通用页行示例：缺省 page 的行自动归入壳自带"通用"页 */
</script>

<template>
  <div class="mx-pref-row">
    <span class="mx-pref-label">版本</span>
    <span :class="$style.value">v0.1.0 · 壳装配演示</span>
  </div>
</template>

<style module>
.value {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}
</style>
