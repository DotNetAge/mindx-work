/**
 * models 插件展示格式化（移植自 mindx-desktop ProviderModelManager.vue 同名函数）。
 * 价格无数据显示 ￥0（定稿）；上下文按 K/M 压缩。
 */

import type { ModelConfig, ProviderInfo } from './types'

/** 供应商显示名：优先 daemon 下发的 title，未设置时首字母大写兜底 */
export function formatProviderTitle(provider: ProviderInfo): string {
  if (provider.title) return provider.title
  return provider.name.charAt(0).toUpperCase() + provider.name.slice(1)
}

/** 数字千分位 */
export function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** 上下文长度按 K/M 格式化（262144 → 256K、1048576 → 1M；无数据"未知"） */
export function formatContextSize(n?: number): string {
  if (!n) return '未知'
  if (n >= 1048576) {
    const k = n / 1048576
    return (Number.isInteger(k) ? k : k.toFixed(1)) + 'M'
  }
  if (n >= 1024) {
    const k = n / 1024
    return (Number.isInteger(k) ? k : Math.round(k)) + 'K'
  }
  return String(n)
}

/** 价格格式化：0.4 → ￥0.4、0.04 → ￥0.04；0 / 未设置 → ￥0 */
export function formatCost(v?: number): string {
  const n = v == null || Number.isNaN(v) ? 0 : v
  return '￥' + String(Number(n.toFixed(4)))
}

/** 模型一行概览：上下文 / 输入 / 输出 / 缓存命中 */
export function modelPriceLine(m: ModelConfig): string {
  return [
    `上下文：${formatContextSize(m.context_length)}`,
    `输入：${formatCost(m.cost_per_1m_in)}`,
    `输出：${formatCost(m.cost_per_1m_out)}`,
    `缓存：${formatCost(m.cost_per_1m_in_cache)}`,
  ].join('  ')
}
