<script setup lang="ts">
/**
 * MemoryFooterRow —— Sidebar Footer 固定区「记忆」入口行（与设置行同区，
 * 几何对齐 ChromeFooter：42 高 / radius 12 / margin 4 -2）。
 * 可用性 = 当前会话存在记忆：跟随 chatflow.store 的 activeSessionId，
 * 经 memory.list_by_session 拉计数；无会话或 0 条时入口置灰不可点（对齐壳
 * row:disabled 观感）。点击打开 Detail 记忆管理 tab；tab 激活态跟随壳
 * Detail.activeTabId 高亮。tab id 与 index.ts 的 MEMORY_DETAIL_ID 同值
 * （本地字面量，避免循环 import）。
 */
import { ref, watch } from 'vue'
import { MxIcon, useService, useShell, useShellData } from '@mindx-work/ui-shell-vue'

// ── 消费侧服务形状声明（插件间禁止 import，本地声明所需最小形状）──────────
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

interface ChatflowService {
  readonly store: { readonly activeSessionId: string }
}

const daemon = useService<DaemonConnection>('daemon.connection')
const chatflow = useService<ChatflowService>('chatflow.store')
const shell = useShell()
const activeTabId = useShellData(() => shell.Detail.activeTabId)

const props = defineProps<{ compact?: boolean }>()

/** 当前会话记忆条数（0 = 入口置灰） */
const memoryCount = ref(0)
const checking = ref(false)
let checkSeq = 0

async function refreshCount(): Promise<void> {
  const sessionId = chatflow.store.activeSessionId
  if (!sessionId) {
    memoryCount.value = 0
    return
  }
  const seq = ++checkSeq
  checking.value = true
  try {
    const result = await daemon.call<{ chunks: unknown[]; count: number }>('memory.list_by_session', {
      session_id: sessionId,
    })
    if (seq !== checkSeq) return // 过期响应丢弃（会话快速切换）
    memoryCount.value = result?.count ?? result?.chunks?.length ?? 0
  } catch {
    if (seq !== checkSeq) return
    memoryCount.value = 0
  } finally {
    if (seq === checkSeq) checking.value = false
  }
}

// 会话切换即重拉计数
watch(
  () => chatflow.store.activeSessionId,
  () => void refreshCount(),
  { immediate: true },
)

function openMemoryPanel(): void {
  if (memoryCount.value === 0) return
  shell.Detail.show('memory-detail')
}
</script>

<template>
  <div :class="$style.footer">
    <button
      type="button"
      :class="[$style.action, { [$style.compactAction]: props.compact }]"
      :data-active="activeTabId === 'memory-detail' ? 'true' : 'false'"
      :disabled="memoryCount === 0"
      :title="memoryCount === 0 ? '当前会话暂无记忆' : `${memoryCount} 条会话记忆`"
      aria-label="打开记忆管理"
      @click="openMemoryPanel"
    >
      <MxIcon name="lucide:brain" :size="props.compact ? 20 : 16" />
      <span v-if="!props.compact" :class="$style.label">记忆</span>
      <span v-if="!props.compact && memoryCount > 0" :class="$style.count">{{ memoryCount }}</span>
    </button>
  </div>
</template>

<style module>
/* 容器：无间距（行自身承载），对齐 ChromeFooter */
.footer {
  display: flex;
  flex-direction: column;
}

/* 入口行：42 高 / radius 12 / margin 4 -2（ChromeFooter.action 同值）；
   tab 激活态复用壳 row data-active 观感（hover 底色）；disabled = 0.4 透明 */
.action {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  width: calc(100% + 4px);
  height: 42px;
  margin: 4px -2px;
  box-sizing: border-box;
  padding: 0 10px 0 8px;
  flex-shrink: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.action:hover:not([data-active='true']):not(:disabled) {
  background: var(--mx-hover);
}

.action:active:not([data-active='true']):not(:disabled) {
  background: var(--mx-active);
}

.action:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.action:disabled {
  opacity: 0.4;
  cursor: default;
}

.action[data-active='true'] {
  background: var(--mx-hover);
}

.label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 记忆计数徽标（micro 字号，弱化胶囊） */
.count {
  flex-shrink: 0;
  font-size: var(--mx-font-micro);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-tertiary);
  padding: 1px 6px;
  background: var(--mx-hover);
  border-radius: 999px;
}

/* 折叠 rail：36x36 居中、radius 12、margin 0（ChromeFooter.compact 同值） */
.compactAction {
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border-radius: var(--mx-radius-card);
}
</style>
