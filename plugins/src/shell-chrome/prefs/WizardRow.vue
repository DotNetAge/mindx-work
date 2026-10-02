<script setup lang="ts">
/** 向导重入行（通用设置页）：打开首启向导窗（主进程幂等；向导窗已开则唤出） */
async function openWizard(): Promise<void> {
  const bridge = window.mxDesktop
  if (!bridge) return
  const ok = await bridge.wizard.open()
  if (!ok) console.error('打开初始化向导失败')
}
</script>

<template>
  <div class="mx-pref-row">
    <span class="mx-pref-label">初始化向导</span>
    <span :class="$style.value">
      <button type="button" :class="$style.open" @click="openWizard">重新运行向导</button>
    </span>
  </div>
</template>

<style module>
.value {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.open {
  padding: 2px 10px;
  box-sizing: border-box;
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.open:hover {
  background: var(--mx-hover);
}

.open:active {
  background: var(--mx-active);
}

.open:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}
</style>
