/**
 * 连接线：吸附端点计算与端点跟随重算（全部纯 attrs，不读 DOM——帧级高频调用安全）。
 * connFrom/connTo 为顶层字段引用目标图形 id；跟随端点取目标 bbox 四边中点中
 * 离线另一端最近者（动态换边）。删除目标后引用悬空自动脱离为自由线。
 */
import type { BoardShape } from './types'
import { parseTranslate, round1, shapeBBox } from './shapes-geometry'
import type { BBox } from './shapes-geometry'

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left'

/** 吸附锚点（视觉坐标 + 所在边） */
export interface AnchorPoint {
  x: number
  y: number
  side: EdgeSide
}

/** bbox 四边中点（含 translate 的视觉坐标） */
export function edgeMids(b: BBox): AnchorPoint[] {
  const cx = (b.left + b.right) / 2
  const cy = (b.top + b.bottom) / 2
  return [
    { x: cx, y: b.top, side: 'top' },
    { x: b.right, y: cy, side: 'right' },
    { x: cx, y: b.bottom, side: 'bottom' },
    { x: b.left, y: cy, side: 'left' },
  ]
}

/** 离参考点最近的边中点 */
export function nearestMid(mids: AnchorPoint[], ref: { x: number; y: number }): AnchorPoint {
  let best = mids[0]!
  let bd = Infinity
  for (const m of mids) {
    const d = (m.x - ref.x) ** 2 + (m.y - ref.y) ** 2
    if (d < bd) {
      bd = d
      best = m
    }
  }
  return best
}

/** 是否可作为连接端点（text 无准确 bbox 禁止；线自身不作端点） */
export function connectable(s: BoardShape | null | undefined): boolean {
  return !!s && s.kind !== 'text' && s.kind !== 'line'
}

/** 端点跟随重算：conn 引用 ∈ changedIds 的线重写端点；引用悬空（目标已删）脱离。
 * 传空 changedIds 仅做悬空清理（删除/编组吞并目标后调用）。 */
export function updateConns(shapes: BoardShape[], changedIds: Set<number>): void {
  const alive = new Set(shapes.map((s) => s.id))
  for (const line of shapes) {
    if (line.kind !== 'line') continue
    const refs: Array<'connFrom' | 'connTo'> = []
    if (line.connFrom !== undefined) refs.push('connFrom')
    if (line.connTo !== undefined) refs.push('connTo')
    for (const ref of refs) {
      const targetId = line[ref]!
      // 悬空：目标不存在，脱离为自由线
      if (!alive.has(targetId)) {
        delete line[ref]
        continue
      }
      // 不在本次变更集：端点不动
      if (!changedIds.has(targetId)) continue
      const target = shapes.find((s) => s.id === targetId)
      const b = target ? shapeBBox(target) : null
      if (!b) continue
      // 参考点 = 线的另一端（视觉坐标）
      const lt = parseTranslate(line.attrs.transform)
      const other =
        ref === 'connFrom'
          ? { x: (Number(line.attrs.x2) || 0) + lt.x, y: (Number(line.attrs.y2) || 0) + lt.y }
          : { x: (Number(line.attrs.x1) || 0) + lt.x, y: (Number(line.attrs.y1) || 0) + lt.y }
      const best = nearestMid(edgeMids(b), other)
      // 视觉端点写回 attrs（减 line 自身 translate）
      if (ref === 'connFrom') {
        line.attrs.x1 = String(round1(best.x - lt.x))
        line.attrs.y1 = String(round1(best.y - lt.y))
      } else {
        line.attrs.x2 = String(round1(best.x - lt.x))
        line.attrs.y2 = String(round1(best.y - lt.y))
      }
    }
  }
}
