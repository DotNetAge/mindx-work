/**
 * 画布视口控制：缩放（滚轮锚点/步进）、平移（帧增量）、适应内容、百分比显示。
 * 职责边界：只写 view（当前视口矩形）；docBox 是文档逻辑边界（序列化基准），
 * 仅 fitTo 时参与联合计算，缩放平移永不改它。
 * 坐标换算沿用 viewBox meet 模式：scale = min(bw/vw, bh/vh) + 居中补偿，
 * DetailPanel 的指针交互与 bbox 反算全部走本模块。
 */
import type { Ref } from 'vue'
import type { View } from './types'

/** 缩放范围（scale = svg 单位到 css 像素的比率） */
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 40

/** 缩放控件/键盘步进系数 */
export const ZOOM_STEP = 1.25

/** meet 模式换算：容器矩形与视口矩形求比例与居中补偿（DetailPanel 与本模块共用公式） */
export function scaleOf(box: DOMRect, v: View): { scale: number; ox: number; oy: number } {
  const scale = Math.min(box.width / v.w, box.height / v.h)
  return { scale, ox: (box.width - v.w * scale) / 2, oy: (box.height - v.h * scale) / 2 }
}

/** 两矩形联合（含任一为 null 时取另一方） */
export function unionView(a: View | null, b: View | null): View | null {
  if (!a) return b ? { ...b } : null
  if (!b) return { ...a }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export interface ViewportDeps {
  canvasEl: Ref<SVGSVGElement | null>
  /** 当前视口（缩放平移修改它） */
  view: Ref<View>
  /** 文档逻辑边界（fit 联合基准，本模块只读） */
  docBox: Ref<View>
}

export function createViewport(deps: ViewportDeps) {
  const { canvasEl, view, docBox } = deps

  function box(): DOMRect {
    return canvasEl.value!.getBoundingClientRect()
  }

  /** client 坐标 → svg 坐标（meet 居中补偿 + 视口偏移） */
  function svgPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const b = box()
    const { scale, ox, oy } = scaleOf(b, view.value)
    return {
      x: (e.clientX - b.left - ox) / scale + view.value.x,
      y: (e.clientY - b.top - oy) / scale + view.value.y,
    }
  }

  /** 图形当前视觉 bbox（含 transform，client 反换算回 svg 坐标；依赖 DOM 渲染完成） */
  function visualBBox(id: number): { left: number; top: number; right: number; bottom: number } | null {
    const el = canvasEl.value?.querySelector(`[data-shape-id="${id}"]`)
    if (!el) return null
    const b = box()
    const { scale, ox, oy } = scaleOf(b, view.value)
    const r = el.getBoundingClientRect()
    return {
      left: (r.left - b.left - ox) / scale + view.value.x,
      top: (r.top - b.top - oy) / scale + view.value.y,
      right: (r.right - b.left - ox) / scale + view.value.x,
      bottom: (r.bottom - b.top - oy) / scale + view.value.y,
    }
  }

  /** svg 坐标 → client 坐标（悬浮定位反向换算，如 ctxBar 悬挂点） */
  function clientFromSvg(p: { x: number; y: number }): { x: number; y: number } {
    const b = box()
    const { scale, ox, oy } = scaleOf(b, view.value)
    return { x: (p.x - view.value.x) * scale + ox + b.left, y: (p.y - view.value.y) * scale + oy + b.top }
  }

  /** 当前缩放比率（svg 单位 → css 像素；画布未挂载时返回 1） */
  function currentScale(): number {
    if (!canvasEl.value) return 1
    return scaleOf(box(), view.value).scale
  }

  /** 缩放百分比（1:1 = 100%） */
  const percent = (): number => Math.round(currentScale() * 100)

  /**
   * 以 client 锚点缩放：锚点的 svg 坐标缩放前后不动（闭式解，无迭代）。
   * meet 等比缩放时 min 分支恒定，scale' = scale × factor。
   */
  function zoomAt(clientX: number, clientY: number, factor: number): void {
    if (!canvasEl.value) return
    const b = box()
    const { scale, ox, oy } = scaleOf(b, view.value)
    // 锚点 svg 坐标（旧视口下）
    const sx = (clientX - b.left - ox) / scale + view.value.x
    const sy = (clientY - b.top - oy) / scale + view.value.y
    // factor 钳制到缩放范围
    const clamped = Math.min(MAX_ZOOM / scale, Math.max(MIN_ZOOM / scale, factor))
    if (clamped === 1) return
    const newW = view.value.w / clamped
    const newH = view.value.h / clamped
    const { ox: nox, oy: noy } = scaleOf(b, { x: 0, y: 0, w: newW, h: newH })
    view.value = {
      x: sx - (clientX - b.left - nox) / (scale * clamped),
      y: sy - (clientY - b.top - noy) / (scale * clamped),
      w: newW,
      h: newH,
    }
  }

  /** 帧增量平移（client 像素增量；空格拖拽/抓手共用，防叠加膨胀） */
  function panBy(dxClient: number, dyClient: number): void {
    const { scale } = scaleOf(box(), view.value)
    view.value = {
      ...view.value,
      x: view.value.x - dxClient / scale,
      y: view.value.y - dyClient / scale,
    }
  }

  /** 步进缩放（锚点缺省 = 画布中心） */
  function zoomStep(dir: 1 | -1): void {
    if (!canvasEl.value) return
    const b = box()
    zoomAt(b.left + b.width / 2, b.top + b.height / 2, dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
  }

  /** 适应内容：内容 bbox ∪ 文档边界，外扩 10% 边距设为新视口 */
  function fitTo(content: View | null): void {
    const u = unionView(content, docBox.value)
    if (!u) return
    const mx = u.w * 0.1
    const my = u.h * 0.1
    view.value = { x: u.x - mx, y: u.y - my, w: u.w + mx * 2, h: u.h + my * 2 }
  }

  return { svgPoint, visualBBox, clientFromSvg, currentScale, percent, zoomAt, panBy, zoomStep, fitTo }
}

export type Viewport = ReturnType<typeof createViewport>
