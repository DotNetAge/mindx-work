// slot/index.ts —— 槽位公共契约出口（五期）：扩展唯一允许 import 的 ChatFlow 面。
//
// CI 静态层锚点：本出口仅承载槽位契约（类型 + 宿主），禁止 re-export ChatFlow 内部
// 组件（共享件纪律：DiffBody 等内部组件对扩展不可见；复用需求按「共享型组件上提」
// 提为中立 ui 包办理）。通道分治：跨插件数据走壳 services，UI 呈现扩展走槽位，
// 两通道互不相干——宿主不注册为壳服务，扩展不经壳插件循环装载。

export type {
  ChatFlowSlotAction,
  ChatFlowSlotHost,
  ChatFlowSlotPresentation,
  ChatFlowSlotSpec,
  ContributedToolNode,
} from './types'
export { chatflowSlotHost } from './host'
