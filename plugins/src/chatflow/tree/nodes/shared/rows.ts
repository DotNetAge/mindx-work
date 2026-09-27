// 共享「命中行归一」工具（tool.ls / tool.glob / tool.grep 展开态共用）：
// 从节点 outputTail（builder 截取的结果尾段）归一为行数组，供 HitsList 渲染。
// 兼容 JSON 对象（提取列表字段）与纯文本（按行拆分）两种结果形态；
// 输出统一为字符串行，结构化统计（计数徽标）走名片，此处只做展开态回看。

import { parseToolResult } from '../../../toolViewUtils'

/** 展开列表行数上限：审计回看取前段足够，防止超长结果拖垮 DOM */
const MAX_ROWS = 200

/** 从任意 JSON 值递归找第一个字符串数组（matches/hits/entries/results 等常见字段） */
function findStringArray(value: unknown, depth = 0): string[] | null {
  if (depth > 3) return null
  if (Array.isArray(value)) {
    const rows = value
      .map(v => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>
          // 常见条目字段：name/path/file/text/line
          const cand = o.name ?? o.path ?? o.file ?? o.text ?? o.line
          if (typeof cand === 'string' && cand) return cand
          return ''
        }
        return ''
      })
      .filter(Boolean)
    return rows.length ? rows : null
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findStringArray(v, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/**
 * 归一入口：outputTail → 行数组。
 * JSON 形态优先提取字符串数组字段；失败按纯文本行拆分（过滤空行）。
 */
export function rowsFromTail(tail?: string): string[] {
  if (!tail || !tail.trim()) return []
  const parsed = parseToolResult(tail)
  if (parsed) {
    const rows = findStringArray(parsed)
    if (rows) return rows.slice(0, MAX_ROWS)
  }
  return tail
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim())
    .slice(0, MAX_ROWS)
}

/**
 * 解析「file:line:text」形态的命中行（grep 类工具标准输出）。
 * 返回 file / line / text 三段；不匹配时 text 段放原文、file/line 为空。
 * 路径含冒号（Windows 盘符）的场景按最后一个 :数字: 切分，规避误切。
 */
export function parseHitRow(row: string): { file: string; line?: number; text: string } {
  const m = row.match(/^(.+?):(\d+)[:-](.*)$/)
  if (m) {
    // 正则捕获组与匹配同时成立（noUncheckedIndexedAccess 断言）
    return { file: m[1]!, line: Number(m[2]), text: m[3]! }
  }
  return { file: '', text: row }
}
