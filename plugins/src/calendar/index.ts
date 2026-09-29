/**
 * calendar 插件：调度任务日历（移植自 mindx-desktop ScheduleView）。
 * Content 主工作区视图（满高型页面）承载日历本体，Sidebar Footer 固定区提供
 * 入口行（与设置行同区、不随内容滚动，order 排设置上方）。
 * 数据归组件：schedule.list / schedule.create / schedule.del RPC 经 daemon.connection。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import CalendarView from './CalendarView.vue'
import CalendarFooterRow from './CalendarFooterRow.vue'

/** Content 视图条目 id（Footer 入口行与注册/清理共用） */
export const CALENDAR_VIEW_ID = 'calendar-view'

/** Sidebar Footer 入口条目 id */
export const CALENDAR_FOOTER_ID = 'calendar-footer'

export const calendarPlugin: VuePlugin = (ctx) => {
  // Content：日历视图（title 由壳 Toolbar 呈现）
  ctx.Content.add({
    id: CALENDAR_VIEW_ID,
    order: 101,
    title: '日历',
    component: CalendarView,
  })

  // Sidebar Footer 固定区：日历入口行（order 90 < 设置行缺省 100，排设置上方）
  ctx.Sidebar.addFooter({
    id: CALENDAR_FOOTER_ID,
    order: 90,
    component: CalendarFooterRow,
  })

  // 停用清理：席位移除（Footer 无移除通道——契约仅 addFooter，空清理）
  return () => {
    ctx.Content.remove(CALENDAR_VIEW_ID)
  }
}
