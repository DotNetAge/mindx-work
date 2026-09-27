// 工具视图共享工具函数（registry/summary 等非视图逻辑与节点视图共用）。
//
// 源：mindx-desktop components/chat/toolViewUtils.ts。一期只平移 registry 消费的
// 纯函数；二期 A 补齐节点视图消费的视图侧函数（结果解析 / diff 提取 / 文件链接注入）。

import { ElMessage } from 'element-plus'

/**
 * Agent 显示名：按 agent 英文名查已招募列表，优先返回角色中文名，
 * 找不到（未招募/历史遗留）或清单未就绪时回退原名。
 * 供树节点（subagent 名片）统一使用：界面暴露角色而非内部名。
 * 入参形态对齐 desktop agents 清单（role_zh 存于 meta.role_zh，role 为内部角色名兜底）。
 */
export function agentRoleOf(
  name: string,
  agents: Array<{ name: string; role?: string; meta?: { role_zh?: string } }>
): string {
  if (!name) return ''
  const agent = agents.find(a => a.name === name)
  return agent?.meta?.role_zh || agent?.role || name
}

/** 毫秒 → 可读时长 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}.${String(ms % 1000).padStart(3, '0')}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** 大数以 K / M 为单位紧凑展示 */
export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

/** 路径 basename，跨平台分隔符 */
export function basename(path: string): string {
  if (!path) return ''
  return path.split(/[\\/]/).pop() || path
}

// ── 工具结果解析（desktop 平移：parseToolResult / extractDiff / countUnifiedDiff） ──

/**
 * 工具结果文本解析为 JSON 对象（builder 截取的 outputTail 常是 JSON 形态）。
 * 兼容原始 JSON 串与已解析对象两种入参；解析失败返回 null（调用方降级原文展示）。
 */
export function parseToolResult(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return null
  try {
    const parsed = JSON.parse(s)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 从工具结果对象提取 unified diff 文本（兼容 diff / unified_diff / patch 等字段名） */
export function extractDiff(obj: Record<string, unknown> | null): string {
  if (!obj) return ''
  for (const key of ['diff', 'unified_diff', 'patch']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}

/** unified diff ± 行数统计：+ / - 开头行（排除 +++ / --- 文件头） */
export function countUnifiedDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

// ── 文件打开（work 适配：编辑器通道四期接线，先行提示占位） ──────────────────

/**
 * 打开文件：desktop 版经 vscode 命令在编辑器打开；work 侧 monaco workbench 的
 * 文件打开通道尚未具备（无 vscode API 暴露先例，禁止猜测协议），二期 A 以提示占位，
 * 四期随数据层接线时接编辑器命令。
 */
export async function tryOpenFile(filePath: string): Promise<void> {
  if (!filePath) return
  ElMessage.info('文件打开通道待接入: ' + basename(filePath))
}

/** 点击正文链接时若指向本地文件，用文件编辑器打开（FormattedContent / UserMessageRow 共用） */
export function handleContentClick(e: MouseEvent): void {
  // 拦截 a[href^="/"]（绝对路径链接）和 a[href^="file://"]（file 协议）
  const linkTarget = (e.target as HTMLElement).closest('a[href^="/"], a[href^="file://"]')
  if (linkTarget) {
    e.preventDefault()
    const href = (linkTarget as HTMLAnchorElement).getAttribute('href') || ''
    void tryOpenFile(href.replace(/^file:\/\//, ''))
    return
  }
  // 拦截 data-file-path（injectFileLinks 注入的文件路径 span）
  const pathTarget = (e.target as HTMLElement).closest('[data-file-path]')
  if (pathTarget) {
    const rawPath = (pathTarget as HTMLElement).getAttribute('data-file-path') || ''
    void tryOpenFile(rawPath)
  }
}

/**
 * markdown 渲染后遍历 DOM 文本节点检测文件路径并注入可点击 span（desktop 原样平移）。
 * 链接文本只显示文件名（悬停 title 提示完整路径），避免长路径充满显示噪声。
 */
export function injectFileLinks(root: HTMLElement): void {
  // 匹配：
  //   1. /path/to/file.ext、./path、../path、~/path（显式路径）
  //   2. path/to/file.ext（隐式相对路径，前面是空格/行首/括号/引号）
  const pathRe = /((?:\/|\.{1,2}\/|~\/)[^\s<>"'[\](){}|;:!?，。、]+(?:\.[a-zA-Z0-9]{1,8})|(?<=^|[\s(["'`])[^\s<>"'[\](){}|;:!?，。、/]+\/[^\s<>"'[\](){}|;:!?，。、]+\.[a-zA-Z0-9]{1,8})/g

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // 跳过已有 <a> 内的文本（已有链接不重复处理）
      let el = node.parentElement
      while (el && el !== root) {
        if (el.tagName === 'A' || el.hasAttribute?.('data-file-path')) return NodeFilter.FILTER_REJECT
        el = el.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  for (const node of textNodes) {
    const text = node.textContent || ''
    pathRe.lastIndex = 0
    const matches: { match: string; index: number }[] = []
    let m
    while ((m = pathRe.exec(text)) !== null) {
      // 过滤明显不是文件的匹配（如 URL 协议残留、纯数字路径）
      const p = m[1]!
      if (p.startsWith('//') || /^\/\d/.test(p)) continue
      matches.push({ match: p, index: m.index })
    }
    if (!matches.length) continue

    // 从后向前替换，不破坏 index
    matches.reverse()
    let content = text
    for (const { match, index } of matches) {
      const before = content.slice(0, index)
      const after = content.slice(index + match.length)
      // 链接文本只显示文件名，完整路径放 title（悬停可见）与 data-file-path（点击打开）
      const escaped = match.replace(/"/g, '&quot;')
      content =
        before +
        `<span class="file-path-link" data-file-path="${escaped}" title="${escaped}">${basename(match)}</span>` +
        after
    }
    // 用 innerHTML 替换 textNode 的父容器片段（因为插入了 HTML）
    const span = document.createElement('span')
    span.innerHTML = content
    node.parentNode?.replaceChild(span, node)
    // 展开 span 的所有子节点到父级
    const parent = span.parentNode
    if (parent) {
      while (span.firstChild) parent.insertBefore(span.firstChild, span)
      parent.removeChild(span)
    }
  }
}
