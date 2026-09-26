<script setup lang="ts">
/** 连接状态行：实时呈现 daemon 连接状态（读 daemon.connection 服务响应式状态）。 */
import { computed } from 'vue'
import { useService } from '@mindx-work/ui-shell-vue'
import { DAEMON_CONNECTION_SERVICE, stateText } from '../runtime'
import type { ConnectionState } from '../runtime'

/** 服务结构契约（消费侧仅声明所需形状；插件间禁止 import 提供方实现） */
interface DaemonConnection {
  readonly state: ConnectionState
  readonly lastError: string | null
}

const connection = useService<DaemonConnection>(DAEMON_CONNECTION_SERVICE)

// 响应式读取：getter 内读 ref.value 建立依赖；状态枚举经 stateText 映射为中文
const label = computed(() => stateText(connection.state))
const errorText = computed(() => (connection.state === 'error' ? connection.lastError : null))
</script>

<template>
  <div class="mx-pref-row">
    <div class="mx-pref-label">
      <span class="mx-pref-title">连接状态</span>
      <span class="mx-pref-desc">{{ errorText || '与 mindx-daemon 的实时连接' }}</span>
    </div>
    <span :class="$style.status">
      <span
        class="mx-dot"
        :data-state="label === '已连接' ? 'done' : 'pending'"
        :style="{ color: label === '已连接' ? 'var(--mx-state-success)' : 'var(--mx-state-warn)' }"
      />
      {{ label }}
    </span>
  </div>
</template>

<style module>
.status {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}
</style>
