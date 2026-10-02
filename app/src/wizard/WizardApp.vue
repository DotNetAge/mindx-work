<script setup lang="ts">
/**
 * 首启向导容器：分步状态机（定稿：欢迎 → 连接路径 → 远程配置 → 模型导入 → 完成）。
 * 系统动作全在主进程 IPC 与 daemon RPC，本组件只做视图与步进；
 * 跳过是一等公民（每步「稍后再说」= 直接关闭向导窗，主进程交接主窗）。
 * 无宿主桥（纯 Web 直开）时显示不可用提示——向导依赖探测与持久化 IPC。
 */
import { computed, onMounted, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import type { ProbeReport } from './types'
import StepConnect from './StepConnect.vue'
import StepRemote from './StepRemote.vue'
import StepDocker from './StepDocker.vue'
import StepInstall from './StepInstall.vue'
import StepModels from './StepModels.vue'

type Step = 'welcome' | 'connect' | 'remote' | 'docker' | 'install' | 'models' | 'done'

const step = ref<Step>('welcome')
const probe = ref<ProbeReport | null>(null)
const probeFailed = ref(false)
/** 用户选定的 daemon 端点（本地固定 / 远程按配置 / Docker 取容器端口映射）——模型步连接用 */
const daemonUrl = ref('ws://localhost:1314/ws')
const hasBridge = !!window.mxDesktop

const stepIndex = computed(() => {
  const order: Step[] = ['welcome', 'connect', 'docker', 'remote', 'install', 'models', 'done']
  return order.indexOf(step.value)
})

onMounted(async () => {
  if (!hasBridge) return
  try {
    probe.value = (await window.mxDesktop!.probe.run()) as ProbeReport
  } catch {
    probeFailed.value = true
  }
})

/** 选定路径：本地直接落 mode=local 进模型步；远程进远程配置步；Docker 进引导步；安装进安装步 */
function pickPath(path: 'local' | 'remote' | 'docker' | 'install'): void {
  if (path === 'local') {
    daemonUrl.value = 'ws://localhost:1314/ws'
    void window.mxDesktop?.preferences.set('mindx.daemon.mode', 'local')
    step.value = 'models'
    return
  }
  step.value = path
}

function remoteDone(url: string): void {
  daemonUrl.value = url
  step.value = 'models'
}

/** Docker 容器直连完成：连接语义与远程相同（mode=remote，地址来自容器端口映射） */
function dockerDone(url: string): void {
  daemonUrl.value = url
  void window.mxDesktop?.preferences.set('mindx.daemon.mode', 'remote')
  void window.mxDesktop?.preferences.set('mindx.daemon.remoteUrl', url)
  step.value = 'models'
}

/** Docker 引导步重新检测：重跑探测（容器运行后 props 响应式更新出直连候选） */
async function retryProbe(): Promise<void> {
  try {
    probe.value = (await window.mxDesktop!.probe.run()) as ProbeReport
    probeFailed.value = false
  } catch {
    probeFailed.value = true
  }
}

/** 关闭向导窗：主进程 closed 回调交接主窗（重读连接配置 + 前台），防双窗同显 */
function finish(): void {
  window.close()
}
</script>

<template>
  <div :class="$style.page">
    <!-- 无宿主桥：向导不可用（纯 Web 直开 wizard.html） -->
    <div v-if="!hasBridge" :class="$style.center">
      <MxIcon name="lucide:monitor-x" :size="20" />
      <p>此页面需在 MindX Work 应用中打开。</p>
    </div>

    <template v-else>
      <!-- 顶部拖拽带（titleBarStyle hidden 后窗口拖动区；红绿灯是系统层悬浮不受影响） -->
      <div :class="$style.dragBar" />

      <!-- 步骤指示：点 + 标签（Docker 是连接步分支，仍占一个点位） -->
      <div :class="$style.steps" aria-label="向导步骤">
        <span
          v-for="(label, i) in ['欢迎', '连接', 'Docker', '远程', '安装', '模型', '完成']"
          :key="label"
          :class="[$style.stepDot, i === stepIndex ? $style.stepOn : '', i < stepIndex ? $style.stepDone : '']"
          :title="label"
        />
      </div>

      <!-- 居中内容卡（DeepSeek Harness 观感：主区居中 hero） -->
      <main :class="$style.stage">
        <div v-if="step === 'welcome'" :class="$style.hero">
          <!-- 品牌行：官方 logo glyph（mask 取形随主题变色）+ 名称 -->
          <div :class="$style.brandRow">
            <span :class="$style.brandMark" />
            <h1 :class="$style.brand">MindX Work</h1>
          </div>
          <p :class="$style.tagline">首次使用，几分钟完成初始化：连接智能主机、配置模型。</p>
          <p v-if="probeFailed" :class="$style.warn">环境探测失败，仍可继续手动配置。</p>
          <div :class="$style.actions">
            <button type="button" :class="$style.ghost" @click="finish">稍后再说</button>
            <button type="button" :class="$style.primary" data-wizard-start @click="step = 'connect'">
              开始设置
            </button>
          </div>
        </div>

        <StepConnect v-else-if="step === 'connect'" :probe="probe" @pick="pickPath" @skip="finish" />
        <StepRemote v-else-if="step === 'remote'" @done="remoteDone" @skip="finish" />
        <StepDocker
          v-else-if="step === 'docker'"
          :probe="probe"
          @done="dockerDone"
          @retry="retryProbe"
          @back="step = 'connect'"
          @skip="finish"
        />
        <!-- 本机安装步：ready 后连接语义同本机已有（mode=local），组件内自落盘 -->
        <StepInstall v-else-if="step === 'install'" @done="step = 'models'" @back="step = 'connect'" />
        <StepModels v-else-if="step === 'models'" :probe="probe" :daemon-url="daemonUrl" @done="step = 'done'" @skip="finish" />

        <div v-else :class="$style.hero">
          <h2 :class="$style.title">初始化完成</h2>
          <p :class="$style.tagline">
            已保存的配置随时可在「设置」中调整；未完成的步骤可从设置页重新打开向导。
          </p>
          <div :class="$style.actions">
            <button type="button" :class="$style.primary" data-wizard-finish @click="finish">
              进入 MindX Work
            </button>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>

<style module>
/* 全屏实底向导页：居中列布局，无通栏（窗口自带头部语义） */
/* 顶部拖拽带：titleBarStyle hidden 后窗口拖动区（红绿灯系统层悬浮，不受 app-region 影响） */
.dragBar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 38px;
  -webkit-app-region: drag;
}

.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 62px 32px 40px;
  background: var(--mx-bg-window);
  color: var(--mx-text);
}

.center {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

/* 步骤点：当前 accent 实心，已完成半实 */
.steps {
  display: flex;
  gap: var(--mx-space-2);
  margin-bottom: 32px;
}

.stepDot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--mx-separator-soft);
}

.stepOn {
  background: var(--mx-accent);
}

.stepDone {
  background: color-mix(in srgb, var(--mx-accent) 40%, transparent);
}

/* 内容舞台：居中 hero 卡区 */
.stage,
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stage {
  flex: 1;
  justify-content: center;
  width: 100%;
}

.hero {
  gap: var(--mx-space-3);
  width: 100%;
  max-width: 560px;
}

/* 品牌行：logo glyph + 名称（ChromeHeader 同式：mask 取形随主题变色） */
.brandRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
}

.brandMark {
  height: 30px;
  width: calc(30px * 648 / 577);
  display: block;
  background-color: var(--mx-text);
  mask: url('./assets/logo.svg') no-repeat center / contain;
  -webkit-mask: url('./assets/logo.svg') no-repeat center / contain;
}

.brand {
  margin: 0;
  font: var(--mx-font-title);
  font-size: 32px;
  color: var(--mx-text);
}

.title {
  margin: 0;
  font: var(--mx-font-title);
  color: var(--mx-text);
}

.tagline {
  margin: 0;
  text-align: center;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.warn {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-danger);
}

.actions {
  display: flex;
  justify-content: center;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-3);
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
