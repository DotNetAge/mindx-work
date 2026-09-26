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

export type NoticeTone = 'success' | 'error'

/** 推送一条操作结果通知 */
export function pushNotice(shell: Shell, tone: NoticeTone, text: string): void {
  bannerSeq += 1
  shell.Overlay.add({
    id: `models-banner-${bannerSeq}`,
    kind: 'banner',
    component: () => h(NoticeBanner, { tone, text }),
  })
}
