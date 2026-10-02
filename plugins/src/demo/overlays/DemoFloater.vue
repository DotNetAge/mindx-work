<script setup lang="ts">
/**
 * DemoFloater：浮窗演示内容组件（壳渲染头部 chrome，本体只管内容排版）。
 */
</script>

<template>
  <div :class="$style.body">
    <p :class="$style.text">这是一个可拖动的浮窗：按住头部细带即可拖动，点击红灯关闭。</p>
    <p :class="$style.hint">浮窗不阻塞主界面，可以同时打开多个，点击任意浮窗将其置顶。</p>
  </div>
</template>

<style module>
.body {
  padding: var(--mx-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.text {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.hint {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}
</style>
