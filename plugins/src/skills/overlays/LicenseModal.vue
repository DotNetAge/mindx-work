<script setup lang="ts">
/**
 * 许可证阅读 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 内容取挂载时的快照（openLicense 已写入），纯文本 pre 呈现。
 */
import { useShell } from '@mindx-work/ui-shell-vue'
import { useSkillsStore } from '../store'
import { MODAL_SKILL_LICENSE } from '../ids'

const store = useSkillsStore()
const shell = useShell()

// setup 期快照：打开前 openLicense 已写入
const license = store.license

function close(): void {
  shell.Overlay.remove(MODAL_SKILL_LICENSE)
}
</script>

<template>
  <div v-if="license" :class="$style.body">
    <span :class="$style.title">许可证：{{ license.title }}</span>
    <pre :class="$style.content">{{ license.content }}</pre>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">关闭</button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  min-width: 480px;
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.content {
  box-sizing: border-box;
  max-width: 100%;
  max-height: 420px;
  overflow: auto;
  margin: 0;
  padding: var(--mx-space-3);
  background: var(--mx-bg-window);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  font-family: var(--mx-font-family);
  font-size: var(--mx-font-caption);
  line-height: 1.6;
  color: var(--mx-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
