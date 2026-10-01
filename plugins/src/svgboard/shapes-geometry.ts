/**
 * 画布图形纯几何函数：translate 解析/合并、纯 attrs bbox 计算。
 * 全部不读 DOM（帧级高频调用安全），DetailPanel 与 Minimap 共用。
 */
import type { BoardShape } from './types'

/** 数值取整到 0.1（落盘干净） */
export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 解析纯 translate 变换（不匹配返回零位移；其余变换首版不支持） */
export function parseTranslate(transform: string | undefined | null): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 }
  const m = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 }
}

/** 拖动位移：translate 合并（保留此前位移，二次拖动不跳回） */
export function mergeTranslate(shape: BoardShape, dx: number, dy: number): void {
  if (!dx && !dy) return
  const b = parseTranslate(shape.attrs.transform)
  shape.attrs.transform = `translate(${round1(b.x + dx)} ${round1(b.y + dy)})`
}

/** path d 的坐标点提取（近似：M/L/T/S/C/Q 全坐标对，A 只取终点，H/V/Z 跳过）。
 * 相对命令按绝对点近似（首版边界：画板自产 path 只有 M/L 绝对命令）。 */
function pathPoints(d: string): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const re = /([MLCSQTAHVZmlcsqtahvz])([^MLCSQTAHVZmlcsqtahvz]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    const cmd = m[1]!
    const nums = (m[2] || '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g)?.map(Number) || []
    if (cmd === 'Z' || cmd === 'z' || cmd === 'H' || cmd === 'h' || cmd === 'V' || cmd === 'v') continue
    if (cmd === 'A' || cmd === 'a') {
      // 每组 7 参数（rx ry rot large sweep x y），只取终点对
      for (let i = 5; i + 1 < nums.length; i += 7) pts.push([nums[i]!, nums[i + 1]!])
    } else {
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!])
    }
  }
  return pts
}

export interface BBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** 图形 bbox：纯 attrs 解析 + translate 偏移（含 group 递归）。
 * text 无准确 bbox，按字号 × 字数估算（minimap/内容框用途足够）。 */
export function shapeBBox(s: BoardShape): BBox | null {
  const n = (v: string | undefined): number => Number(v) || 0
  let b: BBox | null = null
  if (s.kind === 'rect' || s.kind === 'sticky') {
    b = { left: n(s.attrs.x), top: n(s.attrs.y), right: n(s.attrs.x) + n(s.attrs.width), bottom: n(s.attrs.y) + n(s.attrs.height) }
  } else if (s.kind === 'ellipse') {
    b = {
      left: n(s.attrs.cx) - n(s.attrs.rx),
      top: n(s.attrs.cy) - n(s.attrs.ry),
      right: n(s.attrs.cx) + n(s.attrs.rx),
      bottom: n(s.attrs.cy) + n(s.attrs.ry),
    }
  } else if (s.kind === 'line') {
    b = {
      left: Math.min(n(s.attrs.x1), n(s.attrs.x2)),
      top: Math.min(n(s.attrs.y1), n(s.attrs.y2)),
      right: Math.max(n(s.attrs.x1), n(s.attrs.x2)),
      bottom: Math.max(n(s.attrs.y1), n(s.attrs.y2)),
    }
  } else if (s.kind === 'polygon') {
    const nums = (s.attrs.points || '').trim().split(/[\s,]+/).map(Number)
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      xs.push(nums[i]!)
      ys.push(nums[i + 1]!)
    }
    if (xs.length) b = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
  } else if (s.kind === 'path') {
    const pts = pathPoints(s.attrs.d || '')
    if (pts.length) {
      b = {
        left: Math.min(...pts.map((p) => p[0])),
        top: Math.min(...pts.map((p) => p[1])),
        right: Math.max(...pts.map((p) => p[0])),
        bottom: Math.max(...pts.map((p) => p[1])),
      }
    }
  } else if (s.kind === 'text') {
    const size = n(s.attrs['font-size']) || 24
    b = {
      left: n(s.attrs.x),
      top: n(s.attrs.y) - size,
      right: n(s.attrs.x) + (s.text || '').length * size * 0.62,
      bottom: n(s.attrs.y) + size * 0.2,
    }
  } else if (s.kind === 'group') {
    for (const c of s.children || []) {
      const cb = shapeBBox(c)
      if (!cb) continue
      b = b
        ? { left: Math.min(b.left, cb.left), top: Math.min(b.top, cb.top), right: Math.max(b.right, cb.right), bottom: Math.max(b.bottom, cb.bottom) }
        : cb
    }
  }
  if (!b) return null
  const t = parseTranslate(s.attrs.transform)
  return { left: b.left + t.x, top: b.top + t.y, right: b.right + t.x, bottom: b.bottom + t.y }
}

// ── resize 拉伸几何（视觉 bbox → 新 bbox 的 per-kind 映射）────────────────────

/** path d 逐命令坐标缩放（M/L/T/S/C/Q 全坐标对、A 的 rx/ry 乘几何平均比 + 终点缩放、
 * H/V 单轴、Z 跳过）。相对命令按绝对近似（首版边界：画板自产 path 只有 M/L）。 */
export function scalePathD(d: string, sx: number, sy: number, ax: number, ay: number): string {
  const re = /([MLCSQTAHVZmlcsqtahvz])([^MLCSQTAHVZmlcsqtahvz]*)/g
  const fx = (v: number): number => round1(ax + (v - ax) * sx)
  const fy = (v: number): number => round1(ay + (v - ay) * sy)
  let m: RegExpExecArray | null
  let out = ''
  while ((m = re.exec(d))) {
    const cmd = m[1]!
    const nums = (m[2] || '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g)?.map(Number) || []
    let scaled: number[]
    if (cmd === 'H' || cmd === 'h') scaled = nums.map(fx)
    else if (cmd === 'V' || cmd === 'v') scaled = nums.map(fy)
    else if (cmd === 'Z' || cmd === 'z') scaled = nums
    else if (cmd === 'A' || cmd === 'a') {
      // 每组 7 参数（rx ry rot large sweep x y）：rx/ry 乘几何平均比，终点缩放
      const sr = Math.sqrt(sx * sy)
      scaled = []
      for (let i = 0; i + 6 < nums.length; i += 7) {
        scaled.push(
          round1((nums[i] || 0) * sr),
          round1((nums[i + 1] || 0) * sr),
          nums[i + 2] || 0,
          nums[i + 3] || 0,
          nums[i + 4] || 0,
          fx(nums[i + 5] || 0),
          fy(nums[i + 6] || 0),
        )
      }
    } else {
      // M/L/T/S/C/Q：坐标对逐对缩放（x 走 sx，y 走 sy）
      scaled = nums.map((v, i) => (i % 2 === 0 ? fx(v) : fy(v)))
    }
    out += cmd + scaled.join(' ')
  }
  return out
}

/** polygon points 逐对缩放 */
export function scalePointsStr(points: string, sx: number, sy: number, ax: number, ay: number): string {
  const nums = points.trim().split(/[\s,]+/).map(Number)
  const out: string[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push(`${round1(ax + ((nums[i] || 0) - ax) * sx)} ${round1(ay + ((nums[i + 1] || 0) - ay) * sy)}`)
  }
  return out.join(' ')
}

/** group 递归缩放：group 自身 translate 不动，child translate 按锚点重定位
 * （t' = A + (t − A)·s，视觉点守恒），child 局部几何关于原点乘 s，text 字号乘几何平均比 */
function scaleGroup(g: BoardShape, sx: number, sy: number, ax: number, ay: number): void {
  const tg = parseTranslate(g.attrs.transform)
  const agx = ax - tg.x
  const agy = ay - tg.y
  const sr = Math.sqrt(sx * sy)
  for (const c of g.children || []) {
    const ct = parseTranslate(c.attrs.transform)
    c.attrs.transform = `translate(${round1(agx + (ct.x - agx) * sx)} ${round1(agy + (ct.y - agy) * sy)})`
    scaleLocal(c, sx, sy, sr)
  }
}

/** child 局部几何关于原点缩放（平移已由 translate 承担） */
function scaleLocal(c: BoardShape, sx: number, sy: number, sr: number): void {
  const n = (v: string | undefined): number => Number(v) || 0
  if (c.kind === 'rect' || c.kind === 'sticky') {
    c.attrs.x = String(round1(n(c.attrs.x) * sx))
    c.attrs.y = String(round1(n(c.attrs.y) * sy))
    c.attrs.width = String(round1(n(c.attrs.width) * sx))
    c.attrs.height = String(round1(n(c.attrs.height) * sy))
  } else if (c.kind === 'ellipse') {
    c.attrs.cx = String(round1(n(c.attrs.cx) * sx))
    c.attrs.cy = String(round1(n(c.attrs.cy) * sy))
    c.attrs.rx = String(round1(n(c.attrs.rx) * sx))
    c.attrs.ry = String(round1(n(c.attrs.ry) * sy))
  } else if (c.kind === 'line') {
    c.attrs.x1 = String(round1(n(c.attrs.x1) * sx))
    c.attrs.y1 = String(round1(n(c.attrs.y1) * sy))
    c.attrs.x2 = String(round1(n(c.attrs.x2) * sx))
    c.attrs.y2 = String(round1(n(c.attrs.y2) * sy))
  } else if (c.kind === 'path') {
    c.attrs.d = scalePathD(c.attrs.d || '', sx, sy, 0, 0)
  } else if (c.kind === 'polygon') {
    c.attrs.points = scalePointsStr(c.attrs.points || '', sx, sy, 0, 0)
  } else if (c.kind === 'text') {
    c.attrs['font-size'] = String(Math.max(8, Math.round((n(c.attrs['font-size']) || 24) * sr)))
    c.attrs.x = String(round1(n(c.attrs.x) * sx))
    c.attrs.y = String(round1(n(c.attrs.y) * sy))
  } else if (c.kind === 'group') {
    // 导入外部 SVG 可能产生嵌套 group：translate 乘 s 后逐 child 递归
    const t = parseTranslate(c.attrs.transform)
    c.attrs.transform = `translate(${round1(t.x * sx)} ${round1(t.y * sy)})`
    for (const gc of c.children || []) scaleLocal(gc, sx, sy, sr)
  }
}

/** resize：把 shape 几何从旧 bbox 映射到新 bbox（局部写回，translate 不动）。
 * anchor = 不动角（视觉坐标，缩放公式的不动点）；line 端点拖拽由调用方单独处理。 */
export function applyResize(shape: BoardShape, oldB: BBox, newB: BBox, anchor: { x: number; y: number }): void {
  const sx = (newB.right - newB.left) / (oldB.right - oldB.left || 1)
  const sy = (newB.bottom - newB.top) / (oldB.bottom - oldB.top || 1)
  const t = parseTranslate(shape.attrs.transform)
  const n = (v: string | undefined): number => Number(v) || 0
  if (shape.kind === 'rect' || shape.kind === 'sticky') {
    // sticky 走 rect 尺寸语义（字号不随拉伸变化）
    shape.attrs.x = String(round1(newB.left - t.x))
    shape.attrs.y = String(round1(newB.top - t.y))
    shape.attrs.width = String(round1(newB.right - newB.left))
    shape.attrs.height = String(round1(newB.bottom - newB.top))
  } else if (shape.kind === 'ellipse') {
    shape.attrs.cx = String(round1((newB.left + newB.right) / 2 - t.x))
    shape.attrs.cy = String(round1((newB.top + newB.bottom) / 2 - t.y))
    shape.attrs.rx = String(round1((newB.right - newB.left) / 2))
    shape.attrs.ry = String(round1((newB.bottom - newB.top) / 2))
  } else if (shape.kind === 'text') {
    // 仅四角响应（调用方约束）；锚定左下角随 bbox 移动，字号随高度比
    const size = n(shape.attrs['font-size']) || 24
    shape.attrs['font-size'] = String(Math.max(8, Math.round(size * ((newB.bottom - newB.top) / (oldB.bottom - oldB.top || 1)))))
    shape.attrs.x = String(round1(n(shape.attrs.x) + (newB.left - oldB.left)))
    shape.attrs.y = String(round1(n(shape.attrs.y) + (newB.bottom - oldB.bottom)))
  } else if (shape.kind === 'path') {
    shape.attrs.d = scalePathD(shape.attrs.d || '', sx, sy, anchor.x - t.x, anchor.y - t.y)
  } else if (shape.kind === 'polygon') {
    shape.attrs.points = scalePointsStr(shape.attrs.points || '', sx, sy, anchor.x - t.x, anchor.y - t.y)
  } else if (shape.kind === 'group') {
    scaleGroup(shape, sx, sy, anchor.x, anchor.y)
  }
}
