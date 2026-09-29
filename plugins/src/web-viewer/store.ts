/**
 * web-viewer 插件 store：多页式网页浏览状态（Model）。
 * tab 列表 + 当前激活 tab；open 命令按 URL 去重（已开则聚焦）。
 * 壳引用装配期捕获，store 顶部零 inject 依赖。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const WEB_VIEWER_DETAIL_ID = 'web-viewer-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindWebViewerShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('web-viewer 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 数据契约 ─────────────────────────────────────────────────────────────────

/** 内部页签：iframe 嵌入一个网页（标题取域名，跨域拿不到文档标题） */
export interface WebTab {
  id: string
  url: string
}

// ── store ────────────────────────────────────────────────────────────────────

export const useWebViewerStore = defineStore('web-viewer-store', () => {
  /** 打开的页签（有序） */
  const tabs = ref<WebTab[]>([])
  const activeTabId = ref('')
  let nextSeq = 1

  /** URL 归一化：无协议补 https://（地址栏手输 `example.com` 可用） */
  function normalizeUrl(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }

  /** 域名（tab 标题展示） */
  function hostOf(url: string): string {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  /**
   * 命令 action（契约 §10.3 范式）：打开网页到详情轨道。
   * 同 URL 已开则直接聚焦该页签，否则新开页签。
   */
  function open(rawUrl: string): void {
    const url = normalizeUrl(rawUrl)
    if (!url) return
    const existing = tabs.value.find((t) => t.url === url)
    if (existing) {
      activeTabId.value = existing.id
    } else {
      const tab: WebTab = { id: `web-tab-${nextSeq++}`, url }
      tabs.value = [...tabs.value, tab]
      activeTabId.value = tab.id
    }
    theShell().Detail.show(WEB_VIEWER_DETAIL_ID)
  }

  /** 新开空白页签：空 url 待导航态（地址栏引导输入），连点 + 每次都是新页签 */
  function newTab(): void {
    const tab: WebTab = { id: `web-tab-${nextSeq++}`, url: '' }
    tabs.value = [...tabs.value, tab]
    activeTabId.value = tab.id
    theShell().Detail.show(WEB_VIEWER_DETAIL_ID)
  }

  /** 地址栏导航：改写当前页签 URL */
  function navigate(id: string, rawUrl: string): void {
    const url = normalizeUrl(rawUrl)
    if (!url) return
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index === -1) return
    const next = { ...tabs.value[index]!, url }
    tabs.value = [...tabs.value.slice(0, index), next, ...tabs.value.slice(index + 1)]
  }

  /** 切换激活页签 */
  function setActive(id: string): void {
    if (tabs.value.some((t) => t.id === id)) activeTabId.value = id
  }

  /** 关闭页签：激活相邻页签；全部关闭时收起详情轨道（无页可看） */
  function closeTab(id: string): void {
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index === -1) return
    const rest = tabs.value.filter((t) => t.id !== id)
    tabs.value = rest
    if (rest.length === 0) {
      activeTabId.value = ''
      theShell().Detail.hide()
      return
    }
    if (activeTabId.value === id) {
      const neighbor = rest[Math.min(index, rest.length - 1)]
      activeTabId.value = neighbor ? neighbor.id : ''
    }
  }

  return { tabs, activeTabId, open, newTab, navigate, setActive, closeTab, hostOf }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type WebViewerStore = ReturnType<typeof useWebViewerStore>

export interface WebViewerService {
  readonly store: WebViewerStore
}

export function createWebViewerService(): WebViewerService {
  return {
    get store() {
      return useWebViewerStore()
    },
  }
}
