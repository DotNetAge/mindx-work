/**
 * models 插件内部状态（Model）：供应商/模型清单 + 三条添加途径 + 表单与确认状态。
 * 数据读写全部经 daemon.connection 服务（daemon 为唯一连接源）；
 * 壳编排（Overlay 开合、banner 推送）归组件，本 store 只持数据与 RPC 调用。
 * 动作失败一律抛错由调用方呈现（banner），不做静默降级。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useService } from '@mindx-work/ui-shell-vue'
import type {
  ModelConfig,
  ModelCreateParams,
  OllamaModelDetail,
  OllamaModelInfo,
  OnlineModelInfo,
  ProviderInfo,
} from './types'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 在线模型浏览供应商（RPC 方法名与 daemon 一一对应，实证：mindx-desktop connectionStore） */
export interface OnlineVendor {
  id: string
  label: string
  method: string
}

export const ONLINE_VENDORS: OnlineVendor[] = [
  { id: 'siliconflow', label: '硅基流动', method: 'provider.fetch_siliconflow_models' },
  { id: 'openrouter', label: 'OpenRouter', method: 'provider.fetch_openrouter_models' },
  { id: 'dashscope', label: '通义千问', method: 'provider.fetch_dashscope_models' },
  { id: 'bigmodel', label: '智谱', method: 'provider.fetch_bigmodel_models' },
  { id: 'tencent', label: '腾讯云', method: 'provider.fetch_tencent_models' },
  { id: 'kimi', label: 'Kimi', method: 'provider.fetch_kimi_models' },
  { id: 'minimax', label: 'MiniMax', method: 'provider.fetch_minimax_models' },
]

/** 上下文长度档位（显示标签 ↔ 数值，实证同源组件） */
export const CONTEXT_LENGTH_OPTIONS = [
  { label: '128K', value: 131072 },
  { label: '200K', value: 204800 },
  { label: '256K', value: 262144 },
  { label: '512K', value: 524288 },
  { label: '1M', value: 1048576 },
]

/** 手动模型表单状态（snake_case 字段直映 RPC 参数） */
export interface ModelFormState {
  name: string
  title: string
  description: string
  base_url: string
  contextLengthLabel: string
  cost_per_1m_in: number
  cost_per_1m_out: number
  cost_per_1m_in_cache: number
  is_local: boolean
  func_calling: boolean
  structuring: boolean
  web_searching: boolean
  visioning: boolean
  prefix_con: boolean
  context_cache: boolean
  enabled: boolean
  temperature: number
  top_p: number
}

function defaultModelForm(): ModelFormState {
  return {
    name: '',
    title: '',
    description: '',
    base_url: '',
    contextLengthLabel: '128K',
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
  }
}

export const useModelsStore = defineStore('models-store', () => {
  // 服务本体在 store 初始化时捕获（首次 useModelsStore 由组件 setup 触发，inject 有效）
  const daemon = useService<DaemonConnection>(DAEMON_CONNECTION)

  // ---------- 清单状态 ----------
  const providers = ref<ProviderInfo[]>([])
  const models = ref<ModelConfig[]>([])
  const loaded = ref(false)
  const selectedProvider = ref('')

  const providerList = computed(() =>
    providers.value.map((p) => ({
      ...p,
      modelCount: models.value.filter((m) => m.provider === p.name).length,
    })),
  )
  const currentModels = computed(() =>
    models.value.filter((m) => m.provider === selectedProvider.value),
  )

  /** 全量刷新：provider.list + model.list 并行 */
  async function refresh(): Promise<void> {
    const [providerResult, modelResult] = await Promise.all([
      daemon.call<ProviderInfo[]>('provider.list', {}),
      daemon.call<ModelConfig[]>('model.list', {}),
    ])
    providers.value = providerResult
    models.value = modelResult
    loaded.value = true
  }

  // ---------- 供应商表单 ----------
  const providerForm = ref({ name: '', title: '', base_url: '', api_key: '', auth_token: '' })
  /** 编辑目标供应商名；null = 新增 */
  const editingProviderName = ref<string | null>(null)

  function openAddProvider(): void {
    providerForm.value = { name: '', title: '', base_url: '', api_key: '', auth_token: '' }
    editingProviderName.value = null
  }

  function openEditProvider(provider: ProviderInfo): void {
    editingProviderName.value = provider.name
    // 密钥不回显（daemon 只回传配置与否的布尔），编辑时留空 = 保持不变（同源行为）
    providerForm.value = {
      name: provider.name,
      title: provider.title || '',
      base_url: provider.base_url || '',
      api_key: '',
      auth_token: '',
    }
  }

  /** 保存供应商；Ollama 免密钥自动占位（同源行为） */
  async function saveProvider(): Promise<void> {
    const form = providerForm.value
    const isOllama = form.name.toLowerCase() === 'ollama'
    if (!isOllama && !form.api_key) {
      throw new Error('请填写 API Key（Ollama 等本地来源免填）')
    }
    if (isOllama) form.api_key = 'NONEKey'
    if (editingProviderName.value) {
      await daemon.call<ProviderInfo>('provider.update', { ...form })
    } else {
      await daemon.call<ProviderInfo>('provider.create', { ...form })
      if (!selectedProvider.value) selectedProvider.value = form.name
    }
    await refresh()
  }

  function requestDeleteProvider(provider: ProviderInfo): void {
    const display = provider.title || provider.name
    requestConfirm(
      '删除供应商',
      `确定删除供应商「${display}」？该操作不可恢复。`,
      `供应商「${display}」已删除`,
      async () => {
        await daemon.call<{ message: string }>('provider.delete', { name: provider.name })
        if (selectedProvider.value === provider.name) selectedProvider.value = ''
        await refresh()
      },
    )
  }

  // ---------- 模型表单（manual / ollama 双模式共用一条目） ----------
  const modelForm = ref<ModelFormState>(defaultModelForm())
  /** 编辑目标模型（name + provider 定位）；null = 新增 */
  const editingModelKey = ref<{ name: string; provider: string } | null>(null)
  /** 表单形态：manual = 通用表单；ollama = 本地模型同步选择器 */
  const modelFormMode = ref<'manual' | 'ollama'>('manual')

  function openAddModel(): void {
    const provider = selectedProvider.value
    if (!provider) return
    editingModelKey.value = null
    onlineVendor.value = ''
    if (provider.toLowerCase() === 'ollama') {
      // Ollama 模式：免表单，打开即自动同步（store.openModelForm 后由组件触发 fetchOllama）
      modelFormMode.value = 'ollama'
      ollamaModels.value = []
      ollamaSelected.value = ''
      return
    }
    if (vendorOf(provider)) {
      // 在线浏览：由管理器转开 online modal
      modelFormMode.value = 'manual'
      onlineVendor.value = vendorOf(provider)!.id
      return
    }
    modelFormMode.value = 'manual'
    modelForm.value = defaultModelForm()
  }

  function openEditModel(model: ModelConfig): void {
    editingModelKey.value = { name: model.name, provider: model.provider }
    modelFormMode.value = 'manual'
    // 编辑必走通用表单，清掉可能残留的在线浏览路由（与 openAddModel 同一纪律）
    onlineVendor.value = ''
    const ctxVal = model.context_length || 262144
    const ctxOption = CONTEXT_LENGTH_OPTIONS.find((o) => o.value === ctxVal)
    modelForm.value = {
      name: model.name,
      title: model.title || '',
      description: model.description || '',
      base_url: model.base_url || '',
      contextLengthLabel: ctxOption?.label || '256K',
      cost_per_1m_in: model.cost_per_1m_in ?? 0,
      cost_per_1m_out: model.cost_per_1m_out ?? 0,
      cost_per_1m_in_cache: model.cost_per_1m_in_cache ?? 0,
      is_local: !!model.is_local,
      func_calling: !!model.func_calling,
      structuring: !!model.structuring,
      web_searching: !!model.web_searching,
      visioning: !!model.visioning,
      prefix_con: !!model.prefix_con,
      context_cache: !!model.context_cache,
      enabled: model.enabled !== false,
      temperature: model.temperature ?? 0.7,
      top_p: model.top_p ?? 0,
    }
  }

  /** 保存手动表单；上下文标签换算数值（同源换算） */
  async function saveModel(): Promise<void> {
    const form = modelForm.value
    if (!form.name || !form.title) {
      throw new Error('请填写模型名称与显示名')
    }
    const ctxOption = CONTEXT_LENGTH_OPTIONS.find((o) => o.label === form.contextLengthLabel)
    const payload = {
      ...form,
      provider: editingModelKey.value?.provider ?? selectedProvider.value,
      context_length: ctxOption ? ctxOption.value : 131072,
    }
    if (editingModelKey.value) {
      await daemon.call<ModelConfig>('model.update', payload)
    } else {
      await daemon.call<ModelConfig>('model.create', payload as ModelCreateParams)
    }
    await refresh()
  }

  // ---------- Ollama 本地模型同步 ----------
  const ollamaModels = ref<(OllamaModelInfo & { detail: OllamaModelDetail | null })[]>([])
  const ollamaLoading = ref(false)
  const ollamaSelected = ref('')

  function isOllamaProvider(): boolean {
    return selectedProvider.value.toLowerCase() === 'ollama'
  }

  function ollamaBaseURL(): string {
    const provider = providers.value.find((p) => p.name.toLowerCase() === 'ollama')
    return provider?.base_url || 'http://localhost:11434'
  }

  /** 已添加的 Ollama 模型（选择器中灰显不可选） */
  function isModelAdded(name: string): boolean {
    return currentModels.value.some((m) => m.name === name)
  }

  /** 打开选择器即自动拉取模型清单并并行取详情（定稿交互：无手动同步按钮） */
  async function fetchOllama(): Promise<void> {
    const baseURL = ollamaBaseURL()
    ollamaLoading.value = true
    ollamaModels.value = []
    ollamaSelected.value = ''
    try {
      const result = await daemon.call<{ models: OllamaModelInfo[]; total: number }>(
        'provider.fetch_ollama_models',
        { base_url: baseURL },
      )
      const withDetails = await Promise.all(
        result.models.map(async (m) => {
          try {
            const detail = await daemon.call<OllamaModelDetail>('provider.fetch_ollama_model_detail', {
              base_url: baseURL,
              model_name: m.name,
            })
            return { ...m, detail }
          } catch {
            return { ...m, detail: null }
          }
        }),
      )
      ollamaModels.value = withDetails
    } finally {
      ollamaLoading.value = false
    }
  }

  /** 添加选中的 Ollama 模型；上下文解析失败直接拒绝，绝不静默兜底（同源定稿） */
  async function confirmOllama(): Promise<void> {
    const name = ollamaSelected.value
    if (!name) return
    const model = ollamaModels.value.find((m) => m.name === name)
    if (!model) return
    const ctxLen = model.detail?.context_length
    if (!ctxLen || ctxLen <= 0) {
      throw new Error(
        `无法从 Ollama 读取 ${name} 的上下文长度，模型未添加。请检查 Ollama 服务是否正常运行，或该模型是否完整。`,
      )
    }
    await daemon.call<ModelConfig>('model.create', {
      name,
      title: name,
      provider: 'ollama',
      base_url: ollamaBaseURL(),
      is_local: true,
      func_calling: true,
      structuring: true,
      context_length: ctxLen,
      enabled: true,
    })
    await refresh()
  }

  // ---------- 在线模型浏览 ----------
  const onlineVendor = ref('')
  const onlineModels = ref<OnlineModelInfo[]>([])
  const onlineLoading = ref(false)

  function vendorOf(providerName: string): OnlineVendor | undefined {
    return ONLINE_VENDORS.find((v) => v.id === providerName.toLowerCase())
  }

  /** 打开浏览器即拉取在线模型清单 */
  async function fetchOnline(): Promise<void> {
    const vendor = vendorOf(selectedProvider.value)
    if (!vendor) return
    onlineLoading.value = true
    onlineModels.value = []
    try {
      const result = await daemon.call<{ models: OnlineModelInfo[]; total: number }>(vendor.method, {
        provider: selectedProvider.value,
      })
      onlineModels.value = result.models
    } finally {
      onlineLoading.value = false
    }
  }

  /** 在线模型一键添加 */
  async function addOnlineModel(model: OnlineModelInfo): Promise<void> {
    await daemon.call<ModelConfig>('model.create', {
      name: model.id,
      title: model.title || model.id,
      description: model.description || '',
      provider: selectedProvider.value,
      context_length: model.context_length,
      func_calling: model.func_calling,
      visioning: model.visioning,
      cost_per_1m_in: model.cost_per_1m_in,
      cost_per_1m_out: model.cost_per_1m_out,
    })
    await refresh()
  }

  // ---------- 模型删除 ----------
  function requestDeleteModel(model: ModelConfig): void {
    const display = model.title || model.name
    requestConfirm(
      '删除模型',
      `确定删除模型「${display}」？该操作不可恢复。`,
      `模型「${display}」已删除`,
      async () => {
        await daemon.call<{ message: string }>('model.delete', { name: model.name, provider: model.provider })
        await refresh()
      },
    )
  }

  // ---------- 删除确认（modal 组件消费） ----------
  const pendingConfirm = ref<{ title: string; message: string; successText: string } | null>(null)
  let confirmAction: (() => Promise<void>) | null = null

  function requestConfirm(
    title: string,
    message: string,
    successText: string,
    action: () => Promise<void>,
  ): void {
    pendingConfirm.value = { title, message, successText }
    confirmAction = action
  }

  /** 确认执行：清空状态后执行动作，返回成功文案供调用方推送通知 */
  async function runConfirm(): Promise<string | undefined> {
    const action = confirmAction
    const successText = pendingConfirm.value?.successText
    confirmAction = null
    pendingConfirm.value = null
    await action?.()
    return successText
  }

  function cancelConfirm(): void {
    confirmAction = null
    pendingConfirm.value = null
  }

  return {
    // 清单
    providers,
    models,
    loaded,
    selectedProvider,
    providerList,
    currentModels,
    refresh,
    // 供应商表单
    providerForm,
    editingProviderName,
    openAddProvider,
    openEditProvider,
    saveProvider,
    requestDeleteProvider,
    // 模型表单
    modelForm,
    editingModelKey,
    modelFormMode,
    openAddModel,
    openEditModel,
    saveModel,
    // Ollama
    ollamaModels,
    ollamaLoading,
    ollamaSelected,
    isOllamaProvider,
    isModelAdded,
    fetchOllama,
    confirmOllama,
    // 在线浏览
    onlineVendor,
    onlineModels,
    onlineLoading,
    fetchOnline,
    addOnlineModel,
    // 删除
    requestDeleteModel,
    // 确认
    pendingConfirm,
    runConfirm,
    cancelConfirm,
  }
})
