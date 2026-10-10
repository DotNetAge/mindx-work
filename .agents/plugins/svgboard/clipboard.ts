/**
 * 应用内剪贴板：复制/粘贴/再制（模块级单实例，跨实例粘贴不做）。
 * 粘贴 = 深拷贝 + 全树 id 重分配 + conn 引用按旧→新映射重写（悬空清空）
 * + 偏移放置（连续粘贴错位步进）。
 * 带来源文档指纹（boardKey）：跨画板粘贴丢弃，防串文档内容。
 */
import type { BoardShape } from './types'
import { mergeTranslate } from './shapes-geometry'

/** 剪贴板内容（顶层 shapes 深拷贝）与来源文档指纹 */
let clip: BoardShape[] | null = null
let clipDocKey = ''

/** 连续粘贴的错位步进计数 */
let pasteShift = 0

/** 重编号 shape 树（注入 id 分配器），记录 旧id→新id 映射 */
function renumber(shape: BoardShape, allocateId: () => number, map: Map<number, number>): BoardShape {
  const next: BoardShape = { ...shape, id: allocateId() }
  map.set(shape.id, next.id)
  if (shape.children) next.children = shape.children.map((c) => renumber(c, allocateId, map))
  return next
}

/** 复制选中顶层图形到剪贴板（无选中返回 false；docKey 记录来源画板指纹） */
export function copySelection(shapes: BoardShape[], ids: number[], docKey: string): boolean {
  const picked = shapes.filter((s) => ids.includes(s.id))
  if (!picked.length) return false
  clip = JSON.parse(JSON.stringify(picked)) as BoardShape[]
  clipDocKey = docKey
  pasteShift = 0
  return true
}

/** 是否有可粘贴内容 */
export function hasClip(): boolean {
  return clip !== null
}

/** 粘贴：返回新图形数组（调用方快照后追加并选中）；
 * 来源指纹不符返回 null（跨画板丢弃），无内容返回 []。 */
export function paste(allocateId: () => number, docKey: string, offsetX = 24, offsetY = 24): BoardShape[] | null {
  if (!clip) return []
  if (clipDocKey !== docKey) return null
  const map = new Map<number, number>()
  const out = clip.map((s) => renumber(s, allocateId, map))
  // conn 引用按映射重写；未一起复制的端（悬空）脱离为自由线
  for (const s of out) {
    if (s.connFrom !== undefined) {
      const m = map.get(s.connFrom)
      if (m !== undefined) s.connFrom = m
      else delete s.connFrom
    }
    if (s.connTo !== undefined) {
      const m = map.get(s.connTo)
      if (m !== undefined) s.connTo = m
      else delete s.connTo
    }
  }
  const step = (pasteShift++ % 6) * 24
  for (const s of out) mergeTranslate(s, offsetX + step, offsetY + step)
  return out
}
