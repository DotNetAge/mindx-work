<script setup lang="ts">
/**
 * ToolbarIconButton：Toolbar 席位图标钮原语（28x28 圆形、悬停交互灰、显式 no-drag）。
 * 样式对齐 shell-chrome ChromeHeader 的 toggle 钮范式；图标尺寸 16（MxIcon 两档）。
 */
import MxIcon from './MxIcon.vue'

defineProps<{ icon: string; label: string }>()
const emit = defineEmits<{ activate: [] }>()
</script>

<template>
  <button
    type="button"
    :class="$style.button"
    :aria-label="label"
    :title="label"
    @click="emit('activate')"
  >
    <MxIcon :name="icon" :size="16" />
  </button>
</template>

<style module>
.button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--mx-text-secondary);
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.button:hover {
  background: var(--mx-hover);
}

.button:active {
  background: var(--mx-active);
}

.button:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.button:disabled {
  opacity: 0.4;
  cursor: default;
}

/* macOS 壳：Toolbar 整条为拖动带，席位钮显式 no-drag */
.button {
  -webkit-app-region: no-drag;
}
</style>
