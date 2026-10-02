<script setup lang="ts">
/**
 * ModelSelector —— 模型快速选择器（源：mindx-desktop settings/ModelSelector.vue 全量平移）。
 *
 * 与 desktop 的差异（唯一结构性偏离）：
 * - desktop 直连 connectionStore（switchModel / formatProviderTitle 内聚组件内）；
 *   work 走 props 注入 + select 上抛（ChatFlowPage 执行 store.switchModel）——
 *   保持 ChatFlowPage fixture 回归通道（?fixture=nomodel / disabled 驱动 props
 *   而非 store），先例同 ChatInput 的 connected/models 注入。
 *
 * 行为与 desktop 同构：
 * - 可用模型过滤：Provider 已配置（api_key === true 且有 base_url）且模型未禁用；
 *   Ollama 走 NONEKey 占位，天然满足 api_key 条件；
 * - 按 Provider 分组（首次出现顺序稳定），分组标题用 provider.title 映射表回落首字母大写；
 * - 当前模型显示以服务端配置为权威（store.currentModelName/Provider 传入），组合键
 *   (provider, name) 精准匹配防跨供应商同名错位，仅列表外才回落首个可用模型；
 * - 列表固定高度可滚动，条目展示上下文长度（K/M，无 ctx 后缀）与本地徽标；
 * - 未配置态：脉冲红点 + 齿轮引导；底部固定「模型与供应商设置」入口。
 *
 * 文案：work 无 vue-i18n，全部中文字面量（desktop zh.json 逐条查证）。
 * 样式：全量 --mx-* 语义 token（军规 3），desktop token 按移植计划附录 A 映射。
 */
import { ref, computed } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import type { ModelInfo, ProviderInfo } from '../store'

const props = withDefaults(
  defineProps<{
    /** 模型全字段列表（未过滤；过滤规则组件内执行，desktop availableModels 同构） */
    models?: ModelInfo[]
    /** 供应商原始配置（api_key === true && base_url 判定已配置） */
    rawProviders?: ProviderInfo[]
    /** provider → title 映射（分组标题显示名） */
    providerTitles?: Record<string, string>
    /** 当前生效模型裸名（服务端配置权威；空时组件内回落） */
    currentModelName?: string
    /** 当前生效模型 Provider（与裸名共同构成唯一身份） */
    currentModelProvider?: string
  }>(),
  {
    models: () => [],
    rawProviders: () => [],
    providerTitles: () => ({}),
    currentModelName: '',
    currentModelProvider: ''
  }
)

const emit = defineEmits<{
  (e: 'select', model: ModelInfo): void
  (e: 'open-model-settings'): void
  /** 选择列表打开：宿主此刻重拉模型目录（供应商配置侧变更无推送，打开时拉取） */
  (e: 'open'): void
}>()

// 模型选择 Popover 显隐
const showPicker = ref(false)
// Popover 实例：受控绑定在部分场景会与内部状态脱钩（置 false 不收起），
// 直接调实例 hide() 强制关闭
const pickerRef = ref<{ hide: () => void } | null>(null)

/**
 * 可用模型过滤规则：
 * - Provider 必须已配置（api_key === true，ProviderInfo.api_key 是 boolean）
 * - Provider 必须有 base_url
 * - Model 未被禁用（enabled !== false）
 * Ollama 走 NONEKey 占位，天然满足 api_key 条件
 */
const availableModels = computed<ModelInfo[]>(() => {
  const configuredProviders = new Set(
    props.rawProviders.filter((p) => p.api_key === true && p.base_url).map((p) => p.name)
  )
  return props.models.filter((m) => configuredProviders.has(m.provider) && m.enabled !== false)
})

const hasAvailableModels = computed(() => availableModels.value.length > 0)

/**
 * 按 Provider 分组的可用模型列表，用于 Popover 列表分组渲染。
 * 分组顺序按模型在 models 中的首次出现顺序保持稳定。
 */
const groupedModels = computed(() => {
  const groups = new Map<string, ModelInfo[]>()
  for (const m of availableModels.value) {
    const list = groups.get(m.provider) || []
    list.push(m)
    groups.set(m.provider, list)
  }
  return Array.from(groups.entries()).map(([provider, models]) => ({
    provider,
    title: formatProviderTitle(provider),
    models
  }))
})

/** 供应商显示名（desktop connectionStore.formatProviderTitle 同构：映射表 → 首字母大写回落） */
function formatProviderTitle(provider: string): string {
  return props.providerTitles[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
}

/**
 * 当前显示的模型：以服务端配置（currentModelName）为权威来源。
 * 只要该模型存在于 models 列表就显示它（即使暂不可用/被过滤，也如实反映服务端
 * 当前生效的模型），避免触发器显示成与配置无关的第一个可用模型（表现即“模型随机”）。
 * 仅当服务端配置的模型已不在列表中时，才回落到第一个可用模型保证占据位。
 * 注意：此处仅做显示，不擅自发起切换，真正切换发生在用户点击列表项时。
 */
const currentModel = computed<ModelInfo | undefined>(() => {
  // 组合键 (provider, name) 精准匹配：跨供应商存在同名模型时，裸名匹配会命中
  // 列表中第一个同名项，导致显示/高亮/选中判断全部错位。provider 未知或精准
  // 匹配失败时退化为裸名匹配（无冲突场景等价）。
  const { currentModelName, currentModelProvider, models } = props
  const cur =
    (currentModelProvider
      ? models.find((m) => m.name === currentModelName && m.provider === currentModelProvider)
      : undefined) ?? models.find((m) => m.name === currentModelName)
  if (cur) return cur
  return availableModels.value[0]
})

// 上下文长度按 K/M 单位显示（如 262144 → 256K、1048576 → 1M），去掉 ctx 后缀
function formatContextLength(n: number): string {
  if (n >= 1048576) {
    const m = n / 1048576
    return (Number.isInteger(m) ? m : m.toFixed(1)) + 'M'
  }
  if (n >= 1024) {
    const k = n / 1024
    return (Number.isInteger(k) ? k : k.toFixed(1)) + 'K'
  }
  return String(n)
}

function onSelectModel(m: ModelInfo) {
  // 按 (name, provider) 唯一定位，避免跨供应商同名模型在点击时误切到其他供应商的同名项。
  const hit = availableModels.value.find((x) => x.name === m.name && x.provider === m.provider)
  if (!hit) return
  // 点击任意条目即收起 Popover（含点击当前模型的 no-op 情形）
  showPicker.value = false
  pickerRef.value?.hide()
  // 点击当前已选模型不重复发起切换
  if (hit.name === currentModel.value?.name && hit.provider === currentModel.value?.provider) return
  emit('select', hit)
}

function openManager() {
  // 关闭选择弹窗，避免与新打开的设置面板叠加
  showPicker.value = false
  pickerRef.value?.hide()
  emit('open-model-settings')
}
</script>

<template>
  <div class="model-selector">
    <!-- 未配置态：脉冲齿轮引导 -->
    <div v-if="!hasAvailableModels" class="provider-info unconfigured-state">
      <span class="warning-dot"></span>
      <span class="unconfigured-label">未配置供应商</span>
      <el-tooltip placement="bottom" effect="dark" content="点击配置模型与供应商">
        <button type="button" class="gear-btn pulse" @click="openManager">
          <MxIcon name="lucide:settings" :size="16" />
        </button>
      </el-tooltip>
    </div>

    <!-- 已配置态：Popover 内嵌模型选择列表（固定高度可滚动）+ 底部设置按钮 -->
    <el-popover
      v-else
      ref="pickerRef"
      v-model:visible="showPicker"
      trigger="click"
      placement="bottom-start"
      :width="300"
      popper-class="model-selector-popover"
      @show="emit('open')"
    >
      <template #reference>
        <div class="provider-info picker-trigger">
          <span class="model-label">{{ currentModel?.title || currentModel?.name }}</span>
          <MxIcon name="lucide:chevron-down" :size="16" class="dropdown-arrow" />
        </div>
      </template>

      <!-- 模型列表：固定高度，超出滚动 -->
      <div class="ms-list">
        <template v-for="group in groupedModels" :key="group.provider">
          <div class="ms-group-title">{{ group.title }}</div>
          <div
            v-for="m in group.models"
            :key="`${m.provider}/${m.name}`"
            class="ms-item"
            :class="{ 'is-current': m.name === currentModel?.name && m.provider === currentModel?.provider }"
            @click="onSelectModel(m)"
          >
            <div class="ms-item-main">
              <span class="ms-item-name">{{ m.title || m.name }}</span>
            </div>
            <div class="ms-item-meta">
              <span v-if="m.context_length" class="meta-ctx">{{ formatContextLength(m.context_length) }}</span>
              <span v-if="m.is_local" class="local-tag">本地</span>
            </div>
          </div>
        </template>
      </div>

      <!-- 底部固定：模型与供应商设置 -->
      <button class="ms-setting-btn" @click="openManager">
        <MxIcon name="lucide:settings" :size="16" />
        <span>模型与供应商设置</span>
      </button>
    </el-popover>
  </div>
</template>

<style scoped>
.model-selector {
  display: inline-flex;
  align-items: center;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) var(--mx-space-3);
  background: color-mix(in srgb, var(--mx-bg-window) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 60%, transparent);
  border-radius: var(--mx-radius-control);
  max-width: 100%;
  overflow: hidden;
}

/*
 * 触发器中性样式：一个界面只允许一个 Primary 色组件（本输入区为发送按钮），
 * 模型触发器不得使用 accent 色（用户定稿风格约束）；hover 同样回避 accent，
 * 用前景色混出轻微加深反馈。
 */

.picker-trigger {
  cursor: pointer;
  outline: none;
  transition: all 0.2s ease;
}

.picker-trigger:hover {
  border-color: color-mix(in srgb, var(--mx-text) 25%, transparent);
  background: color-mix(in srgb, var(--mx-text) 6%, transparent);
}

.model-label {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text-secondary);
  font-family: var(--mx-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.dropdown-arrow {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.picker-trigger:hover .dropdown-arrow {
  color: var(--mx-text-secondary);
}

.gear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.gear-btn:hover {
  color: var(--mx-text);
  background: color-mix(in srgb, var(--mx-text) 8%, transparent);
}

/* ── 未配置态 ── */
.provider-info.unconfigured-state {
  border-color: color-mix(in srgb, var(--mx-danger) 35%, transparent);
  background: color-mix(in srgb, var(--mx-danger) 7%, transparent);
}

.warning-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mx-danger);
  flex-shrink: 0;
  animation: pulse-red 2s ease-in-out infinite;
}

.unconfigured-label {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: color-mix(in srgb, var(--mx-danger) 60%, white);
  white-space: nowrap;
}

.gear-btn.pulse {
  animation: gear-attention 2s ease-in-out infinite;
}

@keyframes pulse-red {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mx-danger) 50%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--mx-danger) 0%, transparent); }
}

@keyframes gear-attention {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.15); }
}
</style>

<!-- Popover 面板样式（全局，因为 popper 渲染到 body）。取色受军规 14 约束：
     同屏单 Primary（发送按钮），面板内一律中性 token，强调态用前景深浅 + 字重 -->
<style>
.model-selector-popover.el-popper {
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  padding: var(--mx-space-2);
  box-shadow: var(--mx-shadow-prominent);
}

.model-selector-popover.el-popper .el-popper__arrow::before {
  background: var(--mx-bg-elevated);
  border-color: var(--mx-separator);
}

/* ── 模型列表：固定高度 + 滚动 ── */
.model-selector-popover .ms-list {
  height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
  scrollbar-width: thin;
}

.model-selector-popover .ms-group-title {
  font: var(--mx-font-micro);
  font-weight: 700;
  color: var(--mx-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: var(--mx-space-2) var(--mx-space-3) var(--mx-space-1);
  margin-top: var(--mx-space-1);
  flex-shrink: 0;
  user-select: none;
}

.model-selector-popover .ms-group-title:first-child {
  margin-top: 0;
}

.model-selector-popover .ms-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.model-selector-popover .ms-item:hover {
  background: color-mix(in srgb, var(--mx-text) 5%, transparent);
}

/* 当前项强调（军规 14：禁 accent）——前景加深 + 字重，非 Primary 填充 */
.model-selector-popover .ms-item.is-current {
  background: color-mix(in srgb, var(--mx-text) 8%, transparent);
}

.model-selector-popover .ms-item-main {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-width: 0;
}

.model-selector-popover .ms-item-name {
  color: var(--mx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-selector-popover .ms-item.is-current .ms-item-name {
  font-weight: 600;
}

.model-selector-popover .ms-item-meta {
  display: flex;
  gap: var(--mx-space-2);
  align-items: center;
  font: var(--mx-font-micro);
  flex-shrink: 0;
}

.model-selector-popover .meta-ctx {
  color: var(--mx-text-secondary);
}

.model-selector-popover .local-tag {
  color: var(--mx-text-secondary);
  background: color-mix(in srgb, var(--mx-text) 8%, transparent);
  padding: 1px var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  font-weight: 500;
}

/* ── 底部设置按钮（中性，军规 14） ── */
.model-selector-popover .ms-setting-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-2);
  width: 100%;
  margin-top: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 80%, transparent);
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-secondary);
  font: var(--mx-font-caption);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.model-selector-popover .ms-setting-btn:hover {
  background: color-mix(in srgb, var(--mx-text) 5%, transparent);
  border-color: var(--mx-separator);
  color: var(--mx-text);
}

.model-selector-popover .ms-setting-btn:active {
  background: color-mix(in srgb, var(--mx-text) 10%, transparent);
}
</style>
