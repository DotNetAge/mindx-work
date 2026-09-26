/**
 * phone-pair 插件：手机连接（配对全局弹窗）。
 * 蓝本 mindx-desktop PhonePairDialogs.vue（挂 App.vue 的全局组件）——弹窗不依赖
 * 设置页开合，故不做设置行注册；引擎（轮询 + 通知订阅 + 弹窗编排）在插件激活时
 * 启动并常驻，经壳 Overlay 席位呈现（契约第 8 节编排语义）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import { startPhonePairEngine } from './engine'

export const phonePairPlugin: VuePlugin = (ctx) => {
  // 引擎幂等启动；清理函数覆盖轮询/订阅/弹窗条目（契约第 7 节）
  return startPhonePairEngine(ctx)
}
