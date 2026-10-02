<script setup lang="ts">
/**
 * 本机安装步（三期）：消费主进程安装状态机（daemon-installer.ts——检测/下载/放置/
 * install -s→doctor --fix 装配/launchd 拉起）。本组件只呈现状态与进度，不参与安装逻辑；
 * 错误时展示「讲人话」提示 + 可折叠的诊断详情与 daemon 错误日志（复制反馈用）。
 * ready 后连接语义与本机已有路径一致：落 mode=local 进模型步。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { InstallerStatus } from '@mindx-work/ui-shell'

const emit = defineEmits<{ done: []; back: [] }>()

const status = ref<InstallerStatus | null>(null)
let unsubscribe: (() => void) | null = null
/** 诊断详情折叠态（error 时展开按钮） */
const showDetail = ref(false)
const logContent = ref('')

const state = computed(() => status.value?.state ?? 'boot')
const message = computed(() => status.value?.message ?? '')
const progress = computed(() => status.value?.progress ?? null)
const busy = computed(() =>
  ['detecting', 'downloading', 'extracting', 'registering', 'starting'].includes(state.value)
)
/** 进度条可见 = 下载中（其余阶段无量化进度） */
const showProgress = computed(() => state.value === 'downloading' && progress.value != null)

onMounted(async () => {
  const bridge = window.mxDesktop
  if (!bridge) return
  unsubscribe = bridge.installer.onEvent((next) => {
    status.value = next
  })
  // 先拉快照再启动（幂等：并发 start 合并为一次执行）；快照非 boot 态（重入/已完成）直接采用
  const snapshot = await bridge.installer.getStatus()
  if (snapshot && snapshot.state !== 'boot') {
    status.value = snapshot
    return
  }
  status.value = (await bridge.installer.start()) ?? snapshot
})

onUnmounted(() => unsubscribe?.())

/** 拉取 daemon 错误日志（error 态展开诊断时加载一次） */
async function toggleDetail(): Promise<void> {
  showDetail.value = !showDetail.value
  if (showDetail.value && logContent.value === '') {
    const log = await window.mxDesktop?.installer.getLog()
    logContent.value = log?.content ?? ''
  }
}

async function copyDiagnostics(): Promise<void> {
  const statusSnapshot = status.value
  if (!statusSnapshot) return
  const text = [
    `状态：${statusSnapshot.state}`,
    statusSnapshot.message ? `信息：${statusSnapshot.message}` : '',
    statusSnapshot.errorDetail ? `详情：\n${statusSnapshot.errorDetail}` : '',
    logContent.value ? `daemon 日志（尾部）：\n${logContent.value}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  await navigator.clipboard.writeText(text)
}

/** 安装就绪：落 mode=local（与本机已有路径同语义——daemon 已在本机 1314 运行） */
function finishInstall(): void {
  void window.mxDesktop?.preferences.set('mindx.daemon.mode', 'local')
  emit('done')
}

/** 失败重试（幂等：主进程并发 start 合并执行） */
function retry(): void {
  void window.mxDesktop?.installer.start()
}
</script>

<template>
  <div :class="$style.body">
    <h2 :class="$style.title">安装智能主机</h2>
    <p :class="$style.desc">
      随应用内置的智能主机程序将安装为本机服务，安装完成后自动拉起，全程无需手动操作。
    </p>

    <!-- 运行中：阶段文案 + 下载进度条 -->
    <div v-if="busy" :class="$style.running">
      <span :class="$style.spinner" aria-hidden="true" />
      <span :class="$style.message">{{ message || '准备中…' }}</span>
    </div>
    <div v-if="showProgress" :class="$style.progressTrack">
      <div :class="$style.progressFill" :style="{ width: `${progress}%` }" />
    </div>

    <!-- 就绪 -->
    <div v-if="state === 'ready'" :class="$style.readyBox">
      {{ message || '本机智能主机已就绪' }}
    </div>

    <!-- 平台不支持（Windows 第四期） -->
    <div v-else-if="state === 'unsupported'" :class="$style.errBox">{{ message }}</div>

    <!-- 失败：讲人话提示 + 可折叠诊断 -->
    <template v-else-if="state === 'error'">
      <div :class="$style.errBox">
        {{ message }}
        <button type="button" :class="$style.linkBtn" @click="toggleDetail">
          {{ showDetail ? '收起诊断' : '查看诊断' }}
        </button>
      </div>
      <pre v-if="showDetail" :class="$style.detail">{{ status?.errorDetail || '（无错误详情）' }}{{ logContent ? `\n\n—— daemon 日志（尾部）——\n${logContent}` : '' }}</pre>
      <div v-if="showDetail" :class="$style.detailActions">
        <span :class="$style.detailPath">日志：{{ logContent ? '已附在上方' : '暂无可读日志' }}</span>
        <button type="button" :class="$style.ghost" @click="copyDiagnostics">复制诊断信息</button>
      </div>
    </template>

    <div :class="$style.actions">
      <button type="button" :class="$style.ghost" :disabled="busy" @click="emit('back')">返回</button>
      <button v-if="state === 'error'" type="button" :class="$style.primary" data-wizard-install-retry @click="retry">
        重试
      </button>
      <button v-if="state === 'ready'" type="button" :class="$style.primary" data-wizard-install-done @click="finishInstall">
        继续
      </button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  width: 100%;
  max-width: 560px;
}

.title {
  margin: 0;
  font: var(--mx-font-title);
  color: var(--mx-text);
}

.desc {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.running {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.message {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

/* 阶段指示：旋转环（与 MCP 连接呼吸闪动区分——安装是确定性过程用转动） */
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--mx-separator-soft);
  border-top-color: var(--mx-accent);
  border-radius: 999px;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.progressTrack {
  height: 4px;
  border-radius: 999px;
  background: var(--mx-separator-soft);
  overflow: hidden;
}

.progressFill {
  height: 100%;
  border-radius: 999px;
  background: var(--mx-accent);
  transition: width var(--mx-duration-fast) var(--mx-ease-standard);
}

.readyBox {
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  font: var(--mx-font-body);
  color: var(--mx-accent);
}

.errBox {
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
  font: var(--mx-font-body);
  color: var(--mx-danger);
}

.linkBtn {
  margin-left: var(--mx-space-2);
  border: none;
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-text);
  text-decoration: underline;
  cursor: pointer;
}

.detail {
  margin: 0;
  padding: var(--mx-space-2) var(--mx-space-3);
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: var(--mx-bg-elevated);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.detailActions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.detailPath {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}

.ghost {
  padding: 8px 16px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.ghost:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}

.primary {
  padding: 8px 24px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: var(--mx-accent);
  font: var(--mx-font-body);
  font-weight: 500;
  color: var(--mx-text-on-accent);
  cursor: pointer;
  transition: opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
