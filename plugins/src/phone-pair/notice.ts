/**
 * banner 编排：操作结果顶部通知（单实例通知位：新通知顶掉旧通知，3 秒无操作自动消失）。
 * 条目组件为闭包包装的 NoticeBanner（shell 不传 props，文案在入栈时物化）。
 * 插件间禁止 import，本文件为 phone-pair 插件自带副本（范式同 skills/notice.ts）；
 * 本插件蓝本含中性提示（ElMessage.info），故在三种操作色调外补 info 色调。
 */

import { h } from 'vue'
import type { useShell } from '@mindx-work/ui-shell-vue'
import NoticeBanner from './overlays/NoticeBanner.vue'

/** useShell 返回的壳上下文类型 */
type Shell = ReturnType<typeof useShell>

let bannerSeq = 0

/** 当前在显示的通知（单实例：快速连续事件只保留最新一条，不堆叠） */
let current: { seq: number; timer: ReturnType<typeof setTimeout> } | null = null

export type NoticeTone = 'success' | 'error' | 'warning' | 'info'

/** 推送一条操作结果通知 */
export function pushNotice(shell: Shell, tone: NoticeTone, text: string): void {
  if (current) {
    clearTimeout(current.timer)
    void shell.Overlay.remove(`phone-pair-banner-${current.seq}`)
  }
  bannerSeq += 1
  const seq = bannerSeq
  shell.Overlay.add({
    id: `phone-pair-banner-${seq}`,
    kind: 'banner',
    component: () => h(NoticeBanner, { tone, text }),
  })
  const timer = setTimeout(() => {
    void shell.Overlay.remove(`phone-pair-banner-${seq}`)
    if (current && current.seq === seq) current = null
  }, 3000)
  current = { seq, timer }
}
