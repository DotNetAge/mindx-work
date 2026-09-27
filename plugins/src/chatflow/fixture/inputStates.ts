// 输入区三态 fixture —— 三期验收通道（无真实连接/模型数据源，UI 形态静态驱动）。
// ChatFlowPage 按 URL query 选择预设：缺省常态；?fixture=nomodel → NoModel 整块替换；
// ?fixture=disabled → 连接不可用全禁用态。四期接 connection/models 真数据后整体退役。
//
// 模型数据为 ModelInfo 全字段形状（desktop model.list 条目同构），NORMAL 预设带
// 双供应商配置供 ModelSelector 分组渲染验收。
import type { ModelInfo, ProviderInfo } from '../store'

export interface InputFixtureState {
  /** 连接可用（false = 全禁用态，ModelSelector 随输入区禁用隐藏） */
  connected: boolean
  /** 模型全字段列表（空 = 未配置模型 → NoModel） */
  models: ModelInfo[]
  /** 供应商原始配置（ModelSelector 已配置判定与分组标题） */
  rawProviders: ProviderInfo[]
  /** 当前模型名 */
  currentModel: string
}

const PRESETS: Record<string, InputFixtureState> = {
  nomodel: { connected: true, models: [], rawProviders: [], currentModel: '' },
  disabled: {
    connected: false,
    models: [{ name: 'deepseek-chat', title: 'deepseek-chat', provider: 'deepseek', enabled: true }],
    rawProviders: [{ name: 'deepseek', title: 'DeepSeek', api_key: true, base_url: 'https://api.deepseek.com' }],
    currentModel: 'deepseek-chat',
  },
}

/** 常态预设（缺省回落值，独立常量避开 Record 索引取值歧义；双供应商驱动分组渲染） */
const NORMAL: InputFixtureState = {
  connected: true,
  models: [
    { name: 'deepseek-chat', title: 'deepseek-chat', provider: 'deepseek', enabled: true, context_length: 65536 },
    { name: 'deepseek-reasoner', title: 'deepseek-reasoner', provider: 'deepseek', enabled: true, context_length: 65536 },
    { name: 'qwen3-max', title: 'qwen3-max', provider: 'dashscope', enabled: true, context_length: 262144 },
  ],
  rawProviders: [
    { name: 'deepseek', title: 'DeepSeek', api_key: true, base_url: 'https://api.deepseek.com' },
    { name: 'dashscope', title: 'DashScope', api_key: true, base_url: 'https://dashscope.aliyuncs.com' },
  ],
  currentModel: 'deepseek-chat',
}

/** 从 location.search 解析输入区 fixture 预设（未知值回落常态） */
export function resolveInputFixtureState(search: string): InputFixtureState {
  const name = new URLSearchParams(search).get('fixture') || 'normal'
  return PRESETS[name] ?? NORMAL
}
