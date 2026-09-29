<script setup lang="ts">
/**
 * DiffFooterRow —— Sidebar Footer 固定区「变更」入口行（MemoryFooterRow 同构：
 * 42 高 / radius 12 / margin 4 -2）。可用性 = 当前会话存在待确认文件变更
 * （跟随 chatflow.store 的 pendingFileModificationsBySession[activeSessionId]），
 * 无变更置灰不可点，徽标显示文件数。点击打开 Detail「变更」tab；tab 激活态
 * 跟随壳 Detail.activeTabId 高亮。tab id 与 index.ts 的 DIFF_DETAIL_ID 同值
 * （本地字面量，避免循环 import）。
 */
import { computed } from 'vue'
import { MxIcon, useService, useShell, useShellData } from '@mindx-work/ui-shell-vue'

// ── chatflow.store 服务形状（消费侧本地声明，插件间禁止 import）──────────
interface PendingFileMod {
  path: string
}

interface ChatflowService {
  readonly store: {
    readonly activeSessionId: string
    readonly pendingFileModificationsBySession: Record<string, PendingFileMod[]>
  }
}

const chatflow = useService<ChatflowService>('chatflow.store')
const shell = useShell()
const activeTabId = useShellData(() => shell.Detail.activeTabId)

const props = defineProps<{ compact?: boolean }>()

const pendingFiles = computed(
  () => chatflow.store.pendingFileModificationsBySession[chatflow.store.activeSessionId] || [],
)

function openDiffPanel(): void {
  if (pendingFiles.value.length === 0) return
  shell.Detail.show('diff-detail')
}
</script>

<template>
  <div :class="$style.footer">
    <button
      type="button"
      :class="[$style.action, { [$style.compactAction]: props.compact }]"
      :data-active="activeTabId === 'diff-detail' ? 'true' : 'false'"
      :disabled="pendingFiles.length === 0"
      :title="pendingFiles.length === 0 ? '当前会话暂无待确认变更' : `${pendingFiles.length} 个待确认文件`"
      aria-label="打开文件变更面板"
      @click="openDiffPanel"
    >
      <MxIcon name="lucide:git-compare" :size="props.compact ? 20 : 16" />
      <span v-if="!props.compact" :class="$style.label">变更</span>
      <span v-if="!props.compact && pendingFiles.length > 0" :class="$style.count">
        {{ pendingFiles.length }}
      </span>
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

/* 文件数徽标（micro 字号，弱化胶囊，MemoryFooterRow.count 同形） */
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
