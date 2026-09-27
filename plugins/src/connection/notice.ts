/**
 * banner 编排：操作结果顶部通知（单实例通知位：新通知顶掉旧通知，3 秒无操作自动消失）。
 * 插件间禁止 import，本文件为 connection 插件自带副本（范式同 phone-pair/notice.ts）。
 */

import { h } from 'vue'
import type { useShell } from '@mindx-work/ui-shell-vue'
import NoticeBanner from './overlays/NoticeBanner.vue'

/** useShell 返回的壳上下文类型 */
type Shell = ReturnType<typeof useShell>

let bannerSeq = 0

/** 当前在显示的通知（单实例：快速连续操作只保留最新一条，不堆叠） */
let current: { seq: number; timer: ReturnType<typeof setTimeout> } | null = null

export type NoticeTone = 'success' | 'error' | 'warning' | 'info'

/** 推送一条操作结果通知 */
export function pushNotice(shell: Shell, tone: NoticeTone, text: string): void {
  if (current) {
    clearTimeout(current.timer)
    void shell.Overlay.remove(`conn-banner-${current.seq}`)
  }
  bannerSeq += 1
  const seq = bannerSeq
  shell.Overlay.add({
    id: `conn-banner-${seq}`,
    kind: 'banner',
    component: () => h(NoticeBanner, { tone, text }),
  })
  const timer = setTimeout(() => {
    void shell.Overlay.remove(`conn-banner-${seq}`)
    if (current && current.seq === seq) current = null
  }, 3000)
  current = { seq, timer }
}
