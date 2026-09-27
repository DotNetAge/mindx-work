/**
 * banner 编排：操作结果顶部通知（可堆叠，自增序列号区分 id）。
 * 条目组件为闭包包装的 NoticeBanner（shell 不传 props，文案在入栈时物化，
 * 范式同 app/main.ts 的 createFailureBanner）。
 */

import { h } from 'vue'
import type { useShell } from '@mindx-work/ui-shell-vue'
import NoticeBanner from './overlays/NoticeBanner.vue'

/** useShell 返回的壳上下文类型 */
type Shell = ReturnType<typeof useShell>

let bannerSeq = 0

/** 当前在显示的通知（单实例：快速连续操作只保留最新一条，不堆叠） */
let current: { seq: number; timer: ReturnType<typeof setTimeout> } | null = null

export type NoticeTone = 'success' | 'error'

/** 推送一条操作结果通知 */
export function pushNotice(shell: Shell, tone: NoticeTone, text: string): void {
  if (current) {
    clearTimeout(current.timer)
    void shell.Overlay.remove(`models-banner-${current.seq}`)
  }
  bannerSeq += 1
  const seq = bannerSeq
  shell.Overlay.add({
    id: `models-banner-${seq}`,
    kind: 'banner',
    component: () => h(NoticeBanner, { tone, text }),
  })
  const timer = setTimeout(() => {
    void shell.Overlay.remove(`models-banner-${seq}`)
    if (current && current.seq === seq) current = null
  }, 3000)
  current = { seq, timer }
}
