<script setup lang="ts">
/** 远程配置步：输入地址 → 实测连接（WebSocket 握手）→ 通过后写入 preferences。
 * 实测失败给出可操作提示；验证通过才允许保存（不落未知可达性的配置）。 */
import { ref } from 'vue'
import { ElMessage } from '@mindx-work/ui-shell-vue'
import { WizardDaemon, wizardStateText } from './daemon'
import type { WizardDaemon as WizardDaemonType } from './daemon'

const emit = defineEmits<{ done: [url: string]; skip: [] }>()

const url = ref('ws://')
const testing = ref(false)
const testState = ref<'idle' | 'testing' | 'ok' | 'error'>('idle')
const testError = ref('')
/** 连接成功保留的客户端实例（保存后交还父级备用，当前版本导入步自建连接） */
let client: WizardDaemonType | null = null

async function test(): Promise<void> {
  const target = url.value.trim()
  if (!/^wss?:\/\//.test(target)) {
    testState.value = 'error'
    testError.value = '地址需要以 ws:// 或 wss:// 开头'
    return
  }
  testing.value = true
  testState.value = 'testing'
  testError.value = ''
  client?.dispose()
  client = new WizardDaemon(target)
  try {
    await client.connect()
    testState.value = 'ok'
  } catch (error) {
    testState.value = 'error'
    testError.value = error instanceof Error ? error.message : '连接失败'
    client.dispose()
    client = null
  } finally {
    testing.value = false
  }
}

async function save(): Promise<void> {
  const target = url.value.trim()
  const bridge = window.mxDesktop?.preferences
  if (!bridge) {
    ElMessage.error('宿主桥不可用，无法保存配置')
    return
  }
  const okMode = await bridge.set('mindx.daemon.mode', 'remote')
  const okUrl = await bridge.set('mindx.daemon.remoteUrl', target)
  if (!okMode || !okUrl) {
    ElMessage.error('配置落盘失败，请重试')
    return
  }
  emit('done', target)
}
</script>

<template>
  <div :class="$style.body">
    <h2 :class="$style.title">连接远程智能主机</h2>
    <p :class="$style.desc">填入远端智能主机的 WebSocket 地址，实测通过后保存。</p>

    <div :class="$style.form">
      <input
        v-model="url"
        :class="$style.input"
        type="text"
        spellcheck="false"
        placeholder="ws://192.168.1.10:1314/ws"
        @keydown.enter="test"
      />
      <button type="button" :class="$style.testBtn" :disabled="testing" @click="test">
        {{ testing ? '测试中…' : '测试连接' }}
      </button>
    </div>
    <p
      v-if="testState === 'ok' || testState === 'error'"
      :class="[$style.feedback, testState === 'ok' ? $style.ok : $style.err]"
    >
      {{ testState === 'ok' ? `连接成功（${wizardStateText('connected')}）` : testError }}
    </p>

    <div :class="$style.actions">
      <button type="button" :class="$style.ghost" @click="emit('skip')">稍后再说</button>
      <button type="button" :class="$style.primary" :disabled="testState !== 'ok'" @click="save">
        保存并继续
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

.form {
  display: flex;
  gap: var(--mx-space-2);
}

/* 大输入卡（DeepSeek Harness 观感）：高 40、1px 边框、聚焦 accent */
.input {
  flex: 1;
  height: 40px;
  padding: 0 var(--mx-space-3);
  box-sizing: border-box;
  border: 1px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: var(--mx-bg-elevated);
  font: var(--mx-font-mono);
  color: var(--mx-text);
}

.input::placeholder {
  color: var(--mx-text-tertiary);
}

.input:focus {
  outline: none;
  border-color: var(--mx-accent);
}

.testBtn {
  height: 40px;
  padding: 0 var(--mx-space-3);
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: var(--mx-bg-elevated);
  font: var(--mx-font-body);
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.testBtn:hover:not(:disabled) {
  background: var(--mx-hover);
}

.testBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.feedback {
  margin: 0;
  font: var(--mx-font-caption);
}

.ok {
  color: var(--mx-accent);
}

.err {
  color: var(--mx-danger);
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
}

.ghost:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}

.primary {
  padding: 8px 20px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: var(--mx-accent);
  font: var(--mx-font-body);
  font-weight: 500;
  color: var(--mx-text-on-accent);
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
