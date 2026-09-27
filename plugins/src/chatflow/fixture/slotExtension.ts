// 五期槽位 fixture 扩展（验收件）：模拟外部扩展经公共契约出口注册槽位。
//
// 装载层防线：不入壳插件循环——仅由 ChatFlowPage 的 ?fixture=slot 通道动态装载，
// 生产装配（app/src/main.ts 插件清单）不含本模块；
// 模块顶层 register = 装配期执行，违规即启动期抛错（装配失败语义）；
// 共享件纪律：仅 import 槽位公共契约（../slot 出口）与壳 UI 原语，不触碰 ChatFlow 内部组件。
import { chatflowSlotHost } from '../slot'
import type { ChatFlowSlotSpec } from '../slot'
import SlotDeployView from './SlotDeployView.vue'

/** 部署工具槽位：后端新增工具（不在内建对照表）经贡献层获得呈现 */
const deploySlot: ChatFlowSlotSpec = {
  key: 'tool.deploy',
  toolNames: ['Deploy'],
  presentation: {
    icon: 'lucide:rocket',
    verb: '已部署',
    executing: '部署中',
    object: (n) => String(n.params.target ?? n.params.service ?? ''),
    badges: (n) => [n.params.version ? `版本 ${String(n.params.version)}` : ''].filter(Boolean),
  },
  view: SlotDeployView,
  viewStandalone: true,
}

chatflowSlotHost.register(deploySlot)
