<script setup lang="ts">
/**
 * 模型导入步（定稿：勾选 + 逐个验证后导入，不静默导入）：
 * 凭据键只见状态位（值在主进程）；「验证并导入」串行执行每个勾选项——
 * 主进程验证（供应商最小请求）→ 取值 → provider.list 查重 → provider.create →
 * model.list 查重 → model.create（bool 全显式传值）。验证失败不落盘不回显 key。
 * 前置：需要 daemon 连接（导入是 daemon RPC）——连接失败给出重试。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ProbeReport, CredentialHit } from './types'
import { IMPORT_MAP } from './types'
import { WizardDaemon } from './daemon'

const props = defineProps<{ probe: ProbeReport | null; daemonUrl: string }>()
const emit = defineEmits<{ done: []; skip: [] }>()

/** 向导自己的 daemon 客户端（模型导入走 RPC） */
let daemon: WizardDaemon | null = null
const daemonState = ref<'connecting' | 'connected' | 'error'>('connecting')

/** 勾选与执行状态（键 → 状态位；值永不入本组件） */
const checked = ref(new Set<string>())
const busy = ref(false)
const results = ref(new Map<string, { state: 'idle' | 'verifying' | 'imported' | 'failed'; reason?: string }>())

/** 可导入的凭据（有映射且非空值）与不可自动处理项 */
const importable = computed<CredentialHit[]>(() => (props.probe?.credentials ?? []).filter((c) => IMPORT_MAP[c.key]))
const unsupported = computed<CredentialHit[]>(() => (props.probe?.credentials ?? []).filter((c) => !IMPORT_MAP[c.key]))

async function connectDaemon(): Promise<void> {
  daemonState.value = 'connecting'
  daemon?.dispose()
  daemon = new WizardDaemon(props.daemonUrl)
  try {
    await daemon.connect()
    daemonState.value = 'connected'
  } catch {
    daemonState.value = 'error'
  }
}

onMounted(connectDaemon)
onUnmounted(() => daemon?.dispose())

function toggle(key: string): void {
  const next = new Set(checked.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  checked.value = next
}

interface ProviderInfo {
  name: string
  base_url?: string
}
interface ProviderRow {
  name?: string
  title?: string
  base_url?: string
  api_key?: string
}

/** 单条凭据：验证 → 取值 → 查重 → provider.create → model.create */
async function importOne(key: string): Promise<void> {
  const plan = IMPORT_MAP[key]
  if (!plan) return
  const set = (state: 'verifying' | 'imported' | 'failed', reason?: string): void => {
    results.value = new Map(results.value).set(key, { state, reason })
  }
  set('verifying')

  // 1. 主进程验证（供应商最小请求；失败即止，不落盘不回显）
  const bridge = window.mxDesktop
  if (!bridge) {
    set('failed', '宿主桥不可用')
    return
  }
  const verify = await bridge.probe.verifyCredential(key)
  if (!verify.ok) {
    set('failed', verify.reason ?? '验证未通过')
    return
  }
  // 2. 主进程取值（一次性；仅存内存用于 RPC 参数）
  const apiKey = await bridge.probe.takeCredential(key)
  if (!apiKey) {
    set('failed', '未找到凭据值')
    return
  }
  if (!daemon || daemonState.value !== 'connected') {
    set('failed', '智能主机未连接')
    return
  }
  try {
    // 3. provider 查重/创建
    const providers = await daemon.call<ProviderInfo[]>('provider.list', {})
    if (!providers.some((p) => p.name === plan.provider)) {
      const row: ProviderRow = {
        name: plan.provider,
        title: plan.providerTitle,
        base_url: plan.baseUrl,
        api_key: apiKey,
      }
      await daemon.call('provider.create', row)
    }
    // 4. model 查重/创建（bool 全显式——AGENTS.md daemon 纪律）
    const models = await daemon.call<{ name: string }[]>('model.list', {})
    if (!models.some((m) => m.name === plan.model)) {
      await daemon.call('model.create', {
        name: plan.model,
        title: plan.modelTitle,
        description: '',
        provider: plan.provider,
        base_url: plan.baseUrl,
        context_length: 131072,
        cost_per_1m_in: 0,
        cost_per_1m_out: 0,
        cost_per_1m_in_cache: 0,
        is_local: false,
        func_calling: true,
        structuring: true,
        web_searching: false,
        visioning: false,
        prefix_con: false,
        context_cache: true,
        enabled: true,
        temperature: 0.7,
        top_p: 0,
      })
    }
    set('imported')
  } catch (error) {
    set('failed', error instanceof Error ? error.message : '导入失败')
  }
}

/** 探测通道经宿主桥 probe 段（preload 暴露；通道族仅向导窗存在期间注册） */

async function importAll(): Promise<void> {
  busy.value = true
  try {
    for (const hit of importable.value) {
      if (!checked.value.has(hit.key)) continue
      if (results.value.get(hit.key)?.state === 'imported') continue
      await importOne(hit.key)
    }
  } finally {
    busy.value = false
  }
}

defineExpose({ connectDaemon })
</script>

<template>
  <div :class="$style.body">
    <h2 :class="$style.title">导入模型凭据</h2>
    <p :class="$style.desc">
      扫描到的 API Key 逐个验证后才会写入智能主机配置；验证失败的项不会被导入。
    </p>

    <div v-if="daemonState === 'error'" :class="$style.daemonErr">
      智能主机连接失败，无法导入模型。
      <button type="button" :class="$style.retry" @click="connectDaemon">重试</button>
    </div>

    <div v-if="importable.length === 0 && unsupported.length === 0" :class="$style.empty">
      未在本机扫描到 API Key（支持 shell 配置与环境变量）。可稍后在设置的模型页手动添加。
    </div>

    <div v-else :class="$style.list">
      <label
        v-for="hit in importable"
        :key="hit.key"
        :class="$style.row"
      >
        <input
          type="checkbox"
          :disabled="busy || results.get(hit.key)?.state === 'imported'"
          :checked="checked.has(hit.key)"
          @change="toggle(hit.key)"
        />
        <span :class="$style.keyLabel">{{ IMPORT_MAP[hit.key]?.providerTitle ?? hit.key }}</span>
        <span :class="$style.keySource">{{ hit.source === 'shellrc' ? '来自 shell 配置' : '来自环境变量' }}</span>
        <span v-if="results.get(hit.key)" :class="[$style.state, results.get(hit.key)!.state === 'imported' ? $style.stateOk : $style.stateFail]">
          {{ results.get(hit.key)!.state === 'imported'
            ? '已导入'
            : results.get(hit.key)!.state === 'verifying'
              ? '验证中…'
              : (results.get(hit.key)!.reason ?? '失败') }}
        </span>
      </label>
      <div v-for="hit in unsupported" :key="hit.key" :class="[$style.row, $style.rowDim]">
        <span :class="$style.keyLabel">{{ hit.key }}</span>
        <span :class="$style.keySource">暂不支持自动导入，请稍后在设置中手动添加</span>
      </div>
    </div>

    <div :class="$style.actions">
      <button type="button" :class="$style.ghost" @click="emit('skip')">稍后再说</button>
      <button
        type="button"
        :class="$style.primary"
        :disabled="busy || daemonState !== 'connected' || checked.size === 0"
        @click="importAll"
      >
        {{ busy ? '导入中…' : `验证并导入（${checked.size}）` }}
      </button>
      <button v-if="results.size > 0" type="button" :class="$style.primary" :disabled="busy" @click="emit('done')">
        完成
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

.daemonErr {
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
  font: var(--mx-font-caption);
  color: var(--mx-danger);
}

.retry {
  margin-left: var(--mx-space-2);
  border: none;
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-text);
  text-decoration: underline;
  cursor: pointer;
}

.empty {
  padding: var(--mx-space-3);
  border: 0.5px dashed var(--mx-border-strong);
  border-radius: var(--mx-radius-card);
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.row:hover {
  background: var(--mx-hover);
}

.rowDim {
  cursor: default;
  opacity: 0.6;
}

.rowDim:hover {
  background: transparent;
}

.keyLabel {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.keySource {
  flex: 1;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.state {
  font: var(--mx-font-caption);
}

.stateOk {
  color: var(--mx-accent);
}

.stateFail {
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
