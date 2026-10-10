<script setup lang="ts">
/**
 * 本机安装步（三期）：消费主进程安装状态机（daemon-installer.ts——检测/下载/放置/
 * install -s→doctor --fix 装配/launchd 拉起）。本组件只呈现状态与进度，不参与安装逻辑；
 * 错误时展示「讲人话」提示 + 可折叠的诊断详情与 daemon 错误日志（复制反馈用）。
 * ready 后连接语义与本机已有路径一致：落 mode=local 进模型步。
 * 就绪后追加官方可选件勾选（发行搭载资源的选择式释放安装，见插件生命周期规范 §11）：
 * 默认全选、用户可取消；单个失败不阻断主流程，行内提示可稍后在插件设置中安装。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

/** 官方可选件条目（plugins:optional-list 回执；只呈现未安装的） */
interface OptionalItem {
  id: string
  name: string
  version: string
  description: string
  author?: string
  file: string
  installed: boolean
}

/** 可选件勾选态（就绪后拉取一次；file 为键） */
const optionals = ref<OptionalItem[]>([])
const checked = ref(new Set<string>())
/** 释放安装进行中（继续按钮防重 + 文案切换） */
const installingOpts = ref(false)
const optError = ref<string | null>(null)
let optionalsLoaded = false

/** 拉取搭载可选件（只显示未安装的；默认全选；列举失败静默跳过——可选件非关键路径） */
async function loadOptionals(): Promise<void> {
  if (optionalsLoaded) return
  optionalsLoaded = true
  try {
    const list = await window.mxDesktop?.plugins?.optionalList()
    optionals.value = (list ?? []).filter((o) => !o.installed)
    checked.value = new Set(optionals.value.map((o) => o.file))
  } catch {
    // 列举失败不阻塞安装步
  }
}

// 就绪时才拉可选件（快照直达 ready 与事件推送两条路径都覆盖）
watch(state, (s) => {
  if (s === 'ready') void loadOptionals()
}, { immediate: true })

function toggleOpt(file: string): void {
  const next = new Set(checked.value)
  if (next.has(file)) next.delete(file)
  else next.add(file)
  checked.value = next
}

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
    logContent.value ? `daemon 日志（尾部）：\n${logContent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  await navigator.clipboard.writeText(text)
}

/**
 * 安装就绪：先释放安装勾选的官方可选件（逐个串行；单个失败记录后继续，不阻断主流程），
 * 然后落 mode=local（与本机已有路径同语义——daemon 已在本机 1314 运行）进模型步。
 */
async function finishInstall(): Promise<void> {
  const pending = optionals.value.filter((o) => checked.value.has(o.file))
  if (pending.length > 0) {
    installingOpts.value = true
    optError.value = null
    const failures: string[] = []
    for (const item of pending) {
      try {
        const res = await window.mxDesktop?.plugins?.optionalInstall(item.file)
        if (res && !res.ok) failures.push(`${item.name}：${res.message ?? '安装失败'}`)
      } catch (error) {
        failures.push(`${item.name}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    installingOpts.value = false
    if (failures.length > 0) {
      optError.value = `部分可选件未能安装（不影响使用，可稍后在设置的插件页安装）：\n${failures.join('；')}`
    }
  }
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

    <!-- 就绪后的官方可选件勾选（选择式释放安装；无搭载或全部已装时不显示） -->
    <div v-if="state === 'ready' && optionals.length > 0" :class="$style.optSection">
      <span :class="$style.optTitle">官方可选件</span>
      <label v-for="opt in optionals" :key="opt.file" :class="$style.optRow">
        <input
          type="checkbox"
          :disabled="installingOpts"
          :checked="checked.has(opt.file)"
          @change="toggleOpt(opt.file)"
        />
        <span :class="$style.optName">{{ opt.name }}</span>
        <span :class="$style.optDesc">{{ opt.description }}</span>
      </label>
      <p v-if="optError" :class="$style.optError">{{ optError }}</p>
    </div>

    <div :class="$style.actions">
      <button type="button" :class="$style.ghost" :disabled="busy" @click="emit('back')">返回</button>
      <button v-if="state === 'error'" type="button" :class="$style.primary" data-wizard-install-retry @click="retry">
        重试
      </button>
      <button
        v-if="state === 'ready'"
        type="button"
        :class="$style.primary"
        data-wizard-install-done
        :disabled="installingOpts"
        @click="finishInstall"
      >
        {{ installingOpts ? '正在安装可选件…' : '继续' }}
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

/* 官方可选件勾选区（就绪后呈现；风格对齐 StepModels 的行式勾选列表） */
.optSection {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: var(--mx-bg-elevated);
}

.optTitle {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
}

.optRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  cursor: pointer;
}

.optName {
  font: var(--mx-font-body);
  color: var(--mx-text);
  white-space: nowrap;
}

.optDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.optError {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-danger);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
