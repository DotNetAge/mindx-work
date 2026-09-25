<script setup lang="ts">
/** demo modal：确认 / 取消都关闭（关闭 = 移除条目） */
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import DemoBanner from './DemoBanner.vue'
import { DEMO_MODAL_ID } from '../ids'

const shell = useShell()

// 守卫重复触发（双击 / 事件重放）：条目已移除时不再调用 remove
const close = () => {
  if (shell.Overlay.has(DEMO_MODAL_ID)) {
    shell.Overlay.remove(DEMO_MODAL_ID)
  }
}

const confirm = () => {
  close()
  // 确认后顶部通知：验证 banner 可堆叠
  shell.Overlay.add({
    id: `demo-banner-confirm-${Date.now()}`,
    kind: 'banner',
    component: DemoBanner,
  })
}
</script>

<template>
  <div :class="$style.modal">
    <div :class="$style.head">
      <MxIcon name="lucide:circle-alert" :size="16" />
      <h2 :class="$style.heading">确认操作</h2>
    </div>
    <p :class="$style.body">
      这是一次全局 modal 演示：同一时刻至多一个，关闭即移除条目；popover / sheet 归插件局部渲染。
    </p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">取消</button>
      <button type="button" class="mx-btn mx-btn--primary" @click="confirm">确认</button>
    </div>
  </div>
</template>

<style module>
.modal {
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
}

.body {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  margin: 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
