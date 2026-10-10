<script setup lang="ts">
/**
 * Detail 工具行动作（owner 归属剪辑 tab）：保存项目与导出 webm（导出中呈现
 * 进度条，可取消）。失败经 ElMessage 透出原因。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useVideoEditorStore } from './store'

const store = useVideoEditorStore()
const saving = ref(false)

async function save(): Promise<void> {
  saving.value = true
  try {
    const ok = await store.saveProject()
    if (ok) ElMessage.success('项目已保存')
    else if (store.error) ElMessage.error(store.error)
  } finally {
    saving.value = false
  }
}

async function exportNow(): Promise<void> {
  const ok = await store.exportVideo()
  if (ok) ElMessage.success('导出完成')
  else if (store.exportMessage) ElMessage.warning(store.exportMessage)
}
</script>

<template>
  <div :class="$style.wrap">
    <template v-if="store.exporting">
      <div :class="$style.progress">
        <div :class="$style.progressTrack">
          <div :class="$style.progressFill" :style="{ width: `${Math.round(store.exportProgress * 100)}%` }" />
        </div>
        <span :class="$style.progressText">{{ Math.round(store.exportProgress * 100) }}%</span>
        <button type="button" class="mx-btn" @click="store.abortExport()">取消</button>
      </div>
    </template>
    <template v-else>
      <button type="button" class="mx-btn" :disabled="saving" @click="save">
        <MxIcon name="lucide:save" :size="16" />
        保存
      </button>
      <button type="button" class="mx-btn mx-btn--primary" @click="exportNow">
        <MxIcon name="lucide:upload" :size="16" />
        导出
      </button>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.progress {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.progressTrack {
  width: 160px;
  height: 6px;
  border-radius: 3px;
  background: var(--mx-module);
  overflow: hidden;
}

.progressFill {
  height: 100%;
  background: var(--mx-accent);
  border-radius: 3px;
  transition: width 120ms ease-out;
}

.progressText {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}
</style>
