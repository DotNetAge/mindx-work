// slot/host.ts —— 槽位宿主（五期）：register API + 启动期校验。
//
// 校验层防线：违规抛错 = 装配失败（扩展在模块顶层调用 register 即装配期，
// 错误直接暴露在启动现场）：
// - presentation 必填且四要素成形（统一名片的最低供给）；
// - 键形状 tool.<snake>（v1 贡献节点形状 = 工具基底派生，非工具族不设槽）；
// - 保留键不可认领：内建 32 型全集（含 null 键 tool.read / tool.sleep 等）；
// - 冲突抛错：键重复 / 工具名与内建对照表冲突 / 工具名跨槽位冲突；
// - actions id 仅限既有 NodeActionId 枚举（分派器归 ChatFlow 内部）。

import { BUILTIN_NODE_TYPE_KEYS, NODE_ACTION_IDS } from '../tree/registry/actions'
import { TOOL_DESCRIPTOR_MAP } from '../tree/builder/tool-map'
import { recordSlotSpec, slotHasKey, slotHasTool } from './registry'
import type { ChatFlowSlotHost, ChatFlowSlotSpec } from './types'

/** 槽位键形状：v1 限工具族（贡献节点 = 工具基底派生） */
const SLOT_KEY_PATTERN = /^tool\.[a-z][a-z0-9_]*$/

/** 校验失败统一抛错形态：装配失败语义（错误信息面向扩展作者） */
function reject(reason: string): never {
  throw new Error(`[chatflow/slot] 槽位注册失败（装配失败）：${reason}`)
}

/** 启动期校验：违规即抛错，全部通过后由调用方落表 */
function validate(spec: ChatFlowSlotSpec): void {
  if (!spec || typeof spec !== 'object') reject('spec 必须是对象')

  if (typeof spec.key !== 'string' || !SLOT_KEY_PATTERN.test(spec.key)) {
    reject(`键 "${String(spec.key)}" 必须是 tool.<snake_case> 形状（v1 槽位只服务工具族节点类型）`)
  }
  if ((BUILTIN_NODE_TYPE_KEYS as readonly string[]).includes(spec.key)) {
    reject(`键 "${spec.key}" 是内建保留键，贡献层不可认领（内建四表穷举保留，含 null 键）`)
  }
  if (slotHasKey(spec.key)) {
    reject(`键 "${spec.key}" 已被其他槽位注册（冲突抛错，扩展间不共享槽位）`)
  }

  const p = spec.presentation
  if (!p || typeof p !== 'object') reject('presentation 必填（统一名片四要素的最低供给）')
  if (typeof p.icon !== 'string' || !p.icon) {
    reject('presentation.icon 必须是非空 Iconify 名称字符串（lucide 集合）')
  }
  if (typeof p.verb !== 'string' && typeof p.verb !== 'function') {
    reject('presentation.verb 必须是状态动词文案或按节点推导的函数')
  }
  if (typeof p.executing === 'undefined') reject('presentation.executing 必填（executing 流光文案）')
  if (typeof p.object !== 'function' || typeof p.badges !== 'function') {
    reject('presentation.object / badges 必须是函数（名片「对象」与「徽标」投影）')
  }

  if (spec.viewStandalone && !spec.view) {
    reject('viewStandalone 需与 view 同时声明（全卡直渲语义依赖视图本体）')
  }

  for (const name of spec.toolNames ?? []) {
    if (Object.prototype.hasOwnProperty.call(TOOL_DESCRIPTOR_MAP, name)) {
      reject(`工具名 "${name}" 已在内建工具对照表登记（保留键，贡献层不可认领）`)
    }
    if (slotHasTool(name)) {
      reject(`工具名 "${name}" 已被其他槽位认领（冲突抛错，扩展间不共享槽位）`)
    }
  }

  for (const action of spec.actions ?? []) {
    if (!NODE_ACTION_IDS.includes(action.id)) {
      reject(`action id "${String(action?.id)}" 不在 NodeActionId 枚举内（分派器归 ChatFlow 内部，扩展不可新增操作语义）`)
    }
  }
}

/** 槽位宿主单例：扩展经公共契约出口（./index）持有 */
export const chatflowSlotHost: ChatFlowSlotHost = {
  register(spec: ChatFlowSlotSpec): void {
    validate(spec)
    recordSlotSpec(spec)
  },
}
