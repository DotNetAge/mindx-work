// 对话流 markdown 渲染（desktop composables/useMarkdown.ts 平移）。
//
// 与 skills/markdown.ts 的分工：skills 版面向 SKILL.md（frontmatter 剥离 + 纯净渲染），
// 本版面向对话流正文（代码块高亮 + mermaid 围栏 + code-block 包装类），随 ChatFlow 内部
// 使用（FormattedContent / thinking 正文 / 残余消息），跨插件复用需求出现时再按共享件办理。

import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import DOMPurify from 'dompurify'

export interface MarkdownRenderer {
  render(source: string): string
}

export interface UseMarkdownReturn {
  md: MarkdownRenderer
  renderMermaidInRoot(root: HTMLElement): Promise<void>
}

// 把 mermaid 围栏代码块渲染为 <div class="mermaid">，供 renderMermaidInRoot 定位渲染。
// 其它代码块用 highlight.js 做语法高亮（atom-one-dark 主题，输出 .hljs token span）。
// renderer 返回 string 表示自定义渲染（不落 marked 默认分支）。
marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang === 'mermaid') {
        // 转义 Mermaid 源码，避免其中包含的 HTML 标签被当作元素解析
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        return `<div class="mermaid">${escaped}</div>\n`
      }
      // 语法高亮：语言标记只保留安全字符（防 class 注入），未知语言回退自动检测
      const language = (lang || '').toLowerCase().replace(/[^\w+#.-]/g, '')
      let highlighted: string
      if (language && hljs.getLanguage(language)) {
        try {
          highlighted = hljs.highlight(text, { language }).value
        } catch {
          highlighted = hljs.highlightAuto(text).value
        }
      } else {
        highlighted = hljs.highlightAuto(text).value
      }
      const langAttr = language ? ` class="hljs language-${language}"` : ' class="hljs"'
      return `<pre class="code-block"><code${langAttr}>${highlighted}</code></pre>\n`
    }
  }
})

export function useMarkdown(): UseMarkdownReturn {
  // Markdown 渲染：marked 解析 + DOMPurify 兜底消毒，返回可安全插入的 HTML
  const md: MarkdownRenderer = {
    render(source: string): string {
      const raw = marked.parse(source ?? '', { gfm: true, breaks: true, async: false }) as string
      return DOMPurify.sanitize(raw)
    }
  }

  // 渲染根节点内的 mermaid 图表（<div class="mermaid">），就地替换为 SVG
  async function renderMermaidInRoot(root: HTMLElement): Promise<void> {
    const diagramEls = root.querySelectorAll<HTMLElement>('div.mermaid')
    if (diagramEls.length === 0) return
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base' })
    let index = 0
    for (const el of diagramEls) {
      const code = el.textContent ?? ''
      try {
        const { svg } = await mermaid.render(`mermaid-${index++}`, code)
        el.innerHTML = svg
      } catch (e) {
        console.warn('[ChatFlow] Mermaid 渲染失败:', e)
      }
    }
  }

  return { md, renderMermaidInRoot }
}
