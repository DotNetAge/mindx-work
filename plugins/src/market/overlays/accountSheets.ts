/**
 * MindX 账号 Sheet 编排器（壳编排归组件层的落点；store 只持数据）。
 * 入口分流：已登录开账户信息页（AccountSheet），未登录开登录遮挡页（AuthRequiredSheet）。
 * Sheet 互斥（同时至多一个）：add 前统一移除在场条目。
 * 组件经动态 import 引用，避免 AccountSheet ↔ AuthRequiredSheet 循环依赖。
 */
import type { useShell } from '@mindx-work/ui-shell-vue'
import { SHEET_ACCOUNT, SHEET_AUTH_REQUIRED, SHEET_BROWSER } from '../ids'
import type { useMarketStore } from '../store'
import { pushNotice } from '../notice'

type Shell = ReturnType<typeof useShell>
type Store = ReturnType<typeof useMarketStore>

/** add 前清场（Sheet 互斥：移除在场条目） */
function clearSheet(shell: Shell): void {
  const current = shell.Sheet.entries[0]
  if (current) shell.Sheet.remove(current.id)
}

/** 打开账户信息页（仿 Apple 账户布局）。未登录时自动改道登录遮挡页。 */
export async function openAccountSheet(shell: Shell, store: Store): Promise<void> {
  if (!store.account) {
    await store.fetchAccount().catch(() => {})
  }
  if (!store.account?.user) {
    await openAuthRequiredSheet(shell, store)
    return
  }
  const { default: AccountSheet } = await import('./AccountSheet.vue')
  clearSheet(shell)
  shell.Sheet.add({ id: SHEET_ACCOUNT, title: 'MindX 账号', component: AccountSheet as never })
}

/** 打开登录遮挡页（全屏登录/注册表单，集中注意力）。已登录时直接改道账户信息页。 */
export async function openAuthRequiredSheet(shell: Shell, store: Store): Promise<void> {
  if (!store.account) {
    await store.fetchAccount().catch(() => {})
  }
  if (store.account?.user) {
    await openAccountSheet(shell, store)
    return
  }
  const { default: AuthRequiredSheet } = await import('./AuthRequiredSheet.vue')
  clearSheet(shell)
  shell.Sheet.add({ id: SHEET_AUTH_REQUIRED, title: 'MindX 账号', component: AuthRequiredSheet as never })
}

/** 打开法律文本（服务条款/隐私声明）：内嵌 BrowserSheet，不开系统浏览器。
 * 登录遮挡页与账户信息页共用此入口。
 * 市场站点地址唯一来源 = 选中源 base_url（store.marketSite）；未加载先刷源目录，
 * 仍缺失则提示（不硬编码兜底地址——市场地址只允许在源目录一处修改）。
 * Sheet 互斥：清场后拉起文档页 */
export async function openLegalDoc(shell: Shell, store: Store, page: 'tos' | 'privacy'): Promise<void> {
  if (!store.marketSite && store.sources.length === 0) {
    await store.fetchSource().catch(() => {})
  }
  const base = store.marketSite
  if (!base) {
    pushNotice(shell, 'error', '暂时连不上社区，无法打开文档')
    return
  }
  const url = `${base.replace(/\/$/, '')}/${page}`
  const { default: BrowserSheet } = await import('./BrowserSheet.vue')
  clearSheet(shell)
  store.browserSheetUrl = url
  shell.Sheet.add({
    id: SHEET_BROWSER,
    title: page === 'tos' ? '服务条款' : '隐私声明',
    component: BrowserSheet as never,
  })
}
