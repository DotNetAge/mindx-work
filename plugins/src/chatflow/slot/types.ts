// slot/types.ts —— 槽位契约类型（五期，概念框架 §8）。
//
// 类型层防线：契约签名无 AppShell——扩展只持 ChatFlowSlotHost，物理上无法触壳任何
// 席位（Content 归 ChatFlow 唯一持有），能力不传递。
// 本文件只做类型与形状声明；运行时出口在 ./index.ts（扩展唯一 import 面）。

import type { Component } from 'vue'
import type { NodeActionId } from '../tree/registry/actions'
import type { ToolNodeBase } from '../tree/types/tool'

/**
 * 贡献层工具节点：builder 为槽位认领的工具产出的通用节点。
 * 不进内建 32 型判别联合（内建四表穷举保留，含 null 键不可认领）；
 * 结构 = 工具公共基底 + 槽位键 + 结构化参数透传。
 */
export interface ContributedToolNode extends ToolNodeBase {
  /** 节点类型键 = 槽位键（tool.<snake>） */
  type: string
  /** tool_exec_start 结构化参数原样透传：贡献视图自行精选投影（禁止 payload dump 由视图作者负责） */
  params: Record<string, unknown>
}

/** 名片四要素（对齐 registry/summary.ts 的 NodePresentation：图标 + 状态动词 + 对象 + 徽标） */
export interface ChatFlowSlotPresentation {
  /** 图标：Iconify 名称（lucide 集合），消费方 <MxIcon :name> 渲染 */
  icon: string
  /** 状态动词（完成态） */
  verb: string | ((node: ContributedToolNode) => string)
  /** executing 流光文案 */
  executing: string | ((node: ContributedToolNode) => string)
  /** 静态 attention 类型：成功也着黄色 */
  attention?: boolean
  /** 名片「对象」：路径 / 命令 / 标题等精选主体 */
  object: (node: ContributedToolNode) => string
  /** 名片「元信息徽标」：空串项会被过滤 */
  badges: (node: ContributedToolNode) => string[]
}

/** 槽位操作声明：id 仅限既有 NodeActionId 枚举（分派器归 ChatFlow 内部，扩展不可新增语义） */
export interface ChatFlowSlotAction {
  id: NodeActionId
  label: string
  /** 图标：Iconify 名称（lucide 集合） */
  icon?: string
  /** 数据可用性：payload 缺数据时隐藏（缺省 = 恒可用） */
  when?: (node: ContributedToolNode) => boolean
  /** 内联操作：常驻渲染于宾语之后 */
  inline?: boolean
}

/**
 * 槽位三件套（§8）：presentation 必填 / view 可选（standalone 语义同内建）/ actions 可选。
 * 查找链 = 贡献层优先、内建层兜底；内建键（含 null 键）不可认领。
 */
export interface ChatFlowSlotSpec {
  /** 节点类型键：v1 限工具族 tool.<snake>（贡献节点形状 = 工具基底派生，非工具族不设槽） */
  key: string
  /** 后端工具名 → 本槽位归一（同 Read/ReadPro 归一语义）；与内建对照表或其他槽位冲突即装配失败 */
  toolNames?: string[]
  presentation: ChatFlowSlotPresentation
  /** 展开态/全卡视图：standalone 语义同内建（视图自带 header/折叠，树壳不套统一名片） */
  view?: Component
  /** 全卡直渲标记：需与 view 同时声明 */
  viewStandalone?: boolean
  actions?: ChatFlowSlotAction[]
}

/** 槽位宿主：扩展唯一持有的对象（签名无 AppShell，类型层防线） */
export interface ChatFlowSlotHost {
  /** 注册槽位：启动期校验，违规抛错 = 装配失败（校验层防线） */
  register(spec: ChatFlowSlotSpec): void
}
