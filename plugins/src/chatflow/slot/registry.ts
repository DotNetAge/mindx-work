// slot/registry.ts —— 贡献层注册表（五期）：槽位落表 + 查询链的「贡献层」侧。
//
// 查找链 = 贡献层优先、内建层兜底：内建三表出口（registry/components.ts 的 viewOf、
// registry/summary.ts 的 presentationOf、registry/actions.ts 的 actionsOf）先查本表再回落；
// builder 未登记工具经 slotNodeTypeOfTool 归一为贡献节点（贡献层只服务后端新增的节点类型）。
// 本文件不 import 任何 Vue 组件与内建注册表（无环依赖，node --test 可直接加载）。

import type { ChatFlowSlotAction, ChatFlowSlotPresentation, ChatFlowSlotSpec } from './types'

/** 贡献视图条目（形态对齐内建 NodeViewEntry：standalone = 全卡直渲语义） */
export interface SlotViewEntry {
  view: ChatFlowSlotSpec['view']
  standalone?: boolean
}

// ── 落表（host 校验通过后经 recordSlotSpec 写入）────────────────────────────

const views = new Map<string, SlotViewEntry>()
const presentations = new Map<string, ChatFlowSlotPresentation>()
const actions = new Map<string, ChatFlowSlotAction[]>()
const toolNameToKey = new Map<string, string>()

/** 落表（内部：host 完成全部校验后调用，外部不可绕过校验直写） */
export function recordSlotSpec(spec: ChatFlowSlotSpec): void {
  views.set(spec.key, { view: spec.view, standalone: spec.viewStandalone })
  presentations.set(spec.key, spec.presentation)
  actions.set(spec.key, spec.actions ? [...spec.actions] : [])
  for (const name of spec.toolNames ?? []) toolNameToKey.set(name, spec.key)
}

// ── 冲突校验供给（host 消费）───────────────────────────────────────────────

/** 键是否已登记 */
export function slotHasKey(key: string): boolean {
  return views.has(key)
}

/** 工具名是否已被槽位认领 */
export function slotHasTool(toolName: string): boolean {
  return toolNameToKey.has(toolName)
}

// ── 查询链「贡献层」侧（内建三表出口消费；键未登记返回 null 走内建兜底）─────

/** 贡献视图查询：仅 view 已声明时返回（名片-only 槽位返回 null，展开态由内建 null 兜底） */
export function slotViewOf(nodeType: string): SlotViewEntry | null {
  const entry = views.get(nodeType)
  return entry && entry.view ? entry : null
}

export function slotPresentationOf(nodeType: string): ChatFlowSlotPresentation | null {
  return presentations.get(nodeType) ?? null
}

export function slotActionsOf(nodeType: string): ChatFlowSlotAction[] | null {
  return actions.get(nodeType) ?? null
}

/** 工具名 → 槽位键（builder 未登记工具的归一入口；未认领返回 null 走残余降级） */
export function slotNodeTypeOfTool(toolName: string): string | null {
  return toolNameToKey.get(toolName) ?? null
}
