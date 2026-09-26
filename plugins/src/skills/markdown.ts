/**
 * SKILL.md 正文渲染：marked 解析 + DOMPurify 消毒 + frontmatter 剥离。
 * 渲染结果经 v-html 注入，消毒防线不可省略。
 */

import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** 剥离 SKILL.md 的 YAML frontmatter，只渲染正文 */
export function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? raw.slice(m[0].length) : raw
}

/** markdown → 消毒后的 HTML（同步解析） */
export function renderMarkdown(raw: string): string {
  const html = marked.parse(stripFrontmatter(raw), { async: false })
  return DOMPurify.sanitize(html)
}
