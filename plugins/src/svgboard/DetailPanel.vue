<script setup lang="ts">
/**
 * svgboard 详情面板：SVG 矢量画板（零依赖，原生 SVG DOM + pointer 事件）。
 * 工具：选择（多选：Shift 点选 / 空白拖动框选）、矩形、椭圆、直线、铅笔（path）、
 * 多边形（依次点击落点，双击/回车/点回起点闭合）、
 * 文本（点击放置 + 浮层编辑，双击已有文本再编辑）、
 * 形状库（presets.ts 预设图形，点击放置到画布视口中心）。
 * 操作：对齐六向（单选对画布、多选互对齐，视觉 bbox 由 getBoundingClientRect
 * 换算）、编组/解组（单层展平语义，group 不嵌套）、撤销快照栈（cap 50）、
 * Delete 删除、⌘S 保存。拖动为帧增量 merge（多选整体位移不叠加膨胀）。
 * 文件：store.open 读回的 SVG 递归导入（g → group；非 translate 变换丢弃，
 * 首版边界）；保存由 store.save 落盘（fs.write 覆盖写 / 新画板系统对话框）。
 * 坐标换算：viewBox meet 模式居中补偿（getBoundingClientRect + 比例换算）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useSvgboardStore } from './store'
import { PRESET_CATEGORIES, SHAPE_PRESETS, previewMarkup } from './presets'
import type { ShapePreset } from './presets'
import type { BoardShape, Tool, View } from './types'
import { createViewport, scaleOf, unionView } from './viewport'
import { applyResize, mergeTranslate, parseTranslate, shapeBBox } from './shapes-geometry'
import type { BBox } from './shapes-geometry'
import { createShapeHistory } from './history'
import { copySelection, hasClip, paste } from './clipboard'
import { exportPng } from './exportPng'
import { STICKY_COLORS, createSticky, stickyRectAttrs, stickyTextAttrs } from './sticky'
import { connectable, edgeMids, nearestMid, updateConns } from './connector'
import type { AnchorPoint } from './connector'
import ZoomControls from './ZoomControls.vue'
import Minimap from './Minimap.vue'

const store = useSvgboardStore()

/** 文档逻辑边界：序列化基准（新建默认，导入取原文档，缩放平移永不改它） */
const docBox = ref<View>({ x: 0, y: 0, w: 1000, h: 700 })
/** 当前视口：滚轮/空格/抓手缩放平移只改它（初始 = 文档边界） */
const view = ref<View>({ x: 0, y: 0, w: 1000, h: 700 })

const shapes = ref<BoardShape[]>([])
const selectedIds = ref<number[]>([])
let nextId = 1

// ── 工具态 ───────────────────────────────────────────────────────────────────
const tool = ref<Tool>('select')
const stroke = ref('#1f2328')
/** 填充色：'none' = 不填充；取色器绑定独立 fillPick（color input 不认 none） */
const fill = ref('none')
const fillPick = ref('#8ab4f8')
const width = ref(2)
const WIDTHS = [2, 4, 8]

function toggleFill(): void {
  fill.value = fill.value === 'none' ? fillPick.value : 'none'
}

const draft = ref<BoardShape | null>(null)
let drawStart: { x: number; y: number } | null = null
/** 铅笔采样的点串（pointermove 累积，提交时合成 path d） */
let pencilPoints: string[] = []
/** select 拖动：上一帧 client 坐标（帧增量 merge，防位移叠加膨胀） */
let lastDrag: { x: number; y: number } | null = null
/** 多边形进行中顶点（svg 坐标；点击落点，双击/回车/点回起点闭合） */
const polyPoints = ref<Array<{ x: number; y: number }>>([])
/** 多边形橡皮筋预览的鼠标位置（移出画布清空） */
const polyHover = ref<{ x: number; y: number } | null>(null)
/** select 框选态（svg 坐标） */
const marquee = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let marqueeStart: { x: number; y: number } | null = null
let marqueeShift = false

// ── resize 拉伸手势 ──────────────────────────────────────────────────────────
/** 柄标识：八向 bbox 柄 + line 两端点柄 */
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2'

/** resize 进行态：startJson 深快照每帧还原后重算（无累积误差） */
interface ResizeGesture {
  id: number
  handle: HandleId
  startBox: BBox
  startJson: string
  startP: { x: number; y: number }
  moved: boolean
}
let resizeGesture: ResizeGesture | null = null

/** 画布平移态：抓手工具或空格按住时拖拽（上一帧 client 坐标） */
let panLast: { x: number; y: number } | null = null
/** 空格按住（临时平移；keyup 复位） */
const spaceDown = ref(false)

/** 橡皮擦进行态（pointerdown 起，up 收口） */
let erasing = false
/** 本手势是否已快照/已删除（零删除时回滚快照） */
let eraserSnapped = false
let eraserRemoved = false

/** 文本编辑浮层（panel 相对定位的 client 坐标） */
const editBox = ref<{ id: number; value: string; x: number; y: number; isNew: boolean } | null>(null)
const editInput = ref<HTMLInputElement | null>(null)

// ── 撤销/重做（双向快照栈由 history 模块承担）───────────────────────────────
const hist = createShapeHistory(shapes)

/** 快照入口（调用点保持不变） */
function snapshot(): void {
  hist.snapshot()
}

function undo(): void {
  hist.undo()
  selectedIds.value = []
  editBox.value = null
  store.dirty = true
}

function redo(): void {
  hist.redo()
  selectedIds.value = []
  editBox.value = null
  store.dirty = true
}

// ── 坐标换算与视口（meet 居中补偿；缩放/平移经 viewport 模块）────────────────
const canvasEl = ref<SVGSVGElement | null>(null)
const panelEl = ref<HTMLDivElement | null>(null)

const vp = createViewport({ canvasEl, view, docBox })
/** client → svg 坐标（指针事件别名） */
const svgPoint = vp.svgPoint
/** 图形当前视觉 bbox（含 transform，依赖 DOM 渲染完成） */
const visualBBox = vp.visualBBox

/** 缩放百分比显示（依赖 view 与画布容器，zoom/fit 即时刷新） */
const zoomPercent = computed(() => {
  if (!canvasEl.value) return 100
  return Math.round(scaleOf(canvasEl.value.getBoundingClientRect(), view.value).scale * 100)
})

/** 坐标数值取整（落盘干净） */
function round(n: number): number {
  return Math.round(n * 10) / 10
}

function shapeAttrs(): Record<string, string> {
  return {
    stroke: stroke.value,
    'stroke-width': String(width.value),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    fill: fill.value,
  }
}

/** 连接线绘制中：终点吸附到的目标 id（up 落定写 connTo） */
let splineTo: number | undefined

/** 指针位置命中的图形元素（elementsFromPoint 自上而下；setPointerCapture 会把
 * move/up/dblclick 的兼容事件 target 重定向到画布 SVG，e.target 不可用）。
 * connectableOnly：跳过线/文本（不可作连接端点），继续向下层找。 */
function hitShapeAt(x: number, y: number, connectableOnly = false): Element | null {
  if (!canvasEl.value) return null
  for (const el of document.elementsFromPoint(x, y)) {
    if (!canvasEl.value.contains(el)) continue
    const hit = el.closest('[data-shape-id]')
    if (!hit) continue
    const shape = shapes.value.find((s) => s.id === Number(hit.getAttribute('data-shape-id')))
    if (connectableOnly && !connectable(shape)) continue
    return hit
  }
  return null
}

/** 连接吸附：指针命中图形 → 取离参考点（默认指针位置）最近的边中点。
 * 终点吸附传线的起点作参考：端点落在朝向源头的边上（与 updateConns 动态换边一致）。 */
function snapAnchor(e: PointerEvent, ref?: { x: number; y: number }): { id: number; pt: AnchorPoint } | null {
  const hit = hitShapeAt(e.clientX, e.clientY, true)
  if (!hit) return null
  const id = Number(hit.getAttribute('data-shape-id'))
  const shape = shapes.value.find((s) => s.id === id)
  const b = shape ? shapeBBox(shape) : null
  if (!b) return null
  return { id, pt: nearestMid(edgeMids(b), ref ?? svgPoint(e)) }
}

// ── 指针交互 ─────────────────────────────────────────────────────────────────

function onPointerDown(e: PointerEvent): void {
  if (editBox.value) confirmEdit()
  // 指针捕获：拖拽移出画布仍持续收 move/up
  canvasEl.value?.setPointerCapture(e.pointerId)
  const p = svgPoint(e)
  // 抓手工具或空格按住：画布平移优先（帧增量走 pointermove）
  if (tool.value === 'hand' || (tool.value === 'select' && spaceDown.value)) {
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  // 橡皮擦：手势开始，命中即删（up 收口回滚零删除快照）
  if (tool.value === 'eraser') {
    erasing = true
    eraserSnapped = false
    eraserRemoved = false
    eraseAt(e)
    return
  }
  if (tool.value === 'select') {
    // resize 柄命中（单选）：进入拉伸手势（快照一次，move 帧更新，up 收口）
    const handleEl = (e.target as Element).closest('[data-handle]')
    if (handleEl && selectedIds.value.length === 1) {
      const shape = selectedShape()
      const b = shape ? visualBBox(shape.id) : null
      if (shape && b) {
        snapshot()
        resizeGesture = {
          id: shape.id,
          handle: (handleEl as Element).getAttribute('data-handle') as HandleId,
          startBox: b,
          startJson: JSON.stringify(shape),
          startP: p,
          moved: false,
        }
      }
      return
    }
    const hit = (e.target as Element).closest('[data-shape-id]')
    if (hit) {
      const id = Number((hit as Element).getAttribute('data-shape-id'))
      if (e.shiftKey) {
        // Shift 点选：追加/移除
        selectedIds.value = selectedIds.value.includes(id)
          ? selectedIds.value.filter((x) => x !== id)
          : [...selectedIds.value, id]
      } else if (!selectedIds.value.includes(id)) {
        selectedIds.value = [id]
      }
      if (selectedIds.value.includes(id)) {
        lastDrag = { x: e.clientX, y: e.clientY }
      }
    } else {
      // 空白处：开始框选
      if (!e.shiftKey) selectedIds.value = []
      marqueeStart = p
      marqueeShift = e.shiftKey
      marquee.value = { x: p.x, y: p.y, w: 0, h: 0 }
    }
    return
  }
  if (tool.value === 'polygon') {
    // 点回起点附近直接闭合；否则落一个顶点
    if (polyPoints.value.length >= 3) {
      const first = polyPoints.value[0]!
      if (Math.hypot(p.x - first.x, p.y - first.y) < 10 / vp.currentScale()) {
        commitPolygon()
        return
      }
    }
    polyPoints.value = [...polyPoints.value, p]
    return
  }
  if (tool.value === 'text') {
    // 阻止 mousedown 默认行为抢焦点：否则编辑框刚聚焦就被 blur 空提交删除
    e.preventDefault()
    placeText(p, { x: e.clientX, y: e.clientY })
    return
  }
  if (tool.value === 'sticky') {
    e.preventDefault()
    placeSticky(p, { x: e.clientX, y: e.clientY })
    return
  }
  if (tool.value === 'spline') {
    // 连接线：起点吸附（命中图形取最近边中点），否则自由起点
    snapshot()
    splineTo = undefined
    const snap = snapAnchor(e)
    const start = snap?.pt || p
    draft.value = {
      id: nextId++,
      kind: 'line',
      attrs: {
        ...shapeAttrs(),
        x1: String(round(start.x)),
        y1: String(round(start.y)),
        x2: String(round(start.x)),
        y2: String(round(start.y)),
      },
      connFrom: snap?.id,
    }
    return
  }
  // 绘制工具：草稿起点（铅笔立即开始累积点）
  snapshot()
  drawStart = p
  pencilPoints = [`${round(p.x)} ${round(p.y)}`]
  const base = shapeAttrs()
  if (tool.value === 'rect') {
    draft.value = { id: nextId++, kind: 'rect', attrs: { ...base, x: String(round(p.x)), y: String(round(p.y)), width: '0', height: '0' } }
  } else if (tool.value === 'ellipse') {
    draft.value = { id: nextId++, kind: 'ellipse', attrs: { ...base, cx: String(round(p.x)), cy: String(round(p.y)), rx: '0', ry: '0' } }
  } else if (tool.value === 'line') {
    draft.value = { id: nextId++, kind: 'line', attrs: { ...base, x1: String(round(p.x)), y1: String(round(p.y)), x2: String(round(p.x)), y2: String(round(p.y)) } }
  } else {
    draft.value = { id: nextId++, kind: 'path', attrs: { ...base, d: `M ${pencilPoints[0]}` } }
  }
}

/** 多边形收口：≥3 个顶点成形状（连续过近点去重，吸收双击闭合的重复落点） */
function commitPolygon(): void {
  const dedup: Array<{ x: number; y: number }> = []
  for (const pt of polyPoints.value) {
    const prev = dedup[dedup.length - 1]
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 2) dedup.push(pt)
  }
  polyPoints.value = []
  polyHover.value = null
  if (dedup.length < 3) return
  snapshot()
  const shape: BoardShape = {
    id: nextId++,
    kind: 'polygon',
    attrs: { ...shapeAttrs(), points: dedup.map((pt) => `${round(pt.x)} ${round(pt.y)}`).join(' ') },
  }
  shapes.value = [...shapes.value, shape]
  selectedIds.value = [shape.id]
  store.dirty = true
}

/** select 拖动：translate 合并改由 shapes-geometry.mergeTranslate 承担 */

function onPointerMove(e: PointerEvent): void {
  // 平移进行中：帧增量滚动视口（优先于一切工具逻辑）
  if (panLast) {
    vp.panBy(e.clientX - panLast.x, e.clientY - panLast.y)
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  // 橡皮擦拖擦：命中的图形持续删除
  if (erasing) {
    eraseAt(e)
    return
  }
  // resize 手势：端点柄直写端点；bbox 柄从起点快照还原后按新 bbox 重算
  if (resizeGesture) {
    const g = resizeGesture
    const p = svgPoint(e)
    if (!g.moved && (p.x !== g.startP.x || p.y !== g.startP.y)) g.moved = true
    const shape = shapes.value.find((s) => s.id === g.id)
    if (!shape) return
    if (g.handle === 'p1' || g.handle === 'p2') {
      // 端点柄：新视觉位置 − translate 直接写端点 attrs；手拖端点脱离该端连接
      const t = parseTranslate(shape.attrs.transform)
      if (g.handle === 'p1') {
        if (shape.connFrom !== undefined) delete shape.connFrom
        shape.attrs.x1 = String(round(p.x - t.x))
        shape.attrs.y1 = String(round(p.y - t.y))
      } else {
        if (shape.connTo !== undefined) delete shape.connTo
        shape.attrs.x2 = String(round(p.x - t.x))
        shape.attrs.y2 = String(round(p.y - t.y))
      }
    } else {
      // 还原起点快照后映射到新 bbox（MIN 钳制防翻转；anchor = 不动角）
      const restored = JSON.parse(g.startJson) as BoardShape
      shape.attrs = restored.attrs
      shape.children = restored.children
      shape.text = restored.text
      const MIN = 4
      const h = g.handle
      const sb = g.startBox
      let left = sb.left
      let right = sb.right
      let top = sb.top
      let bottom = sb.bottom
      if (h.includes('w')) left = Math.min(p.x, right - MIN)
      if (h.includes('e')) right = Math.max(p.x, left + MIN)
      if (h.includes('n')) top = Math.min(p.y, bottom - MIN)
      if (h.includes('s')) bottom = Math.max(p.y, top + MIN)
      const anchor = {
        x: h.includes('w') ? sb.right : h.includes('e') ? sb.left : (sb.left + sb.right) / 2,
        y: h.includes('n') ? sb.bottom : h.includes('s') ? sb.top : (sb.top + sb.bottom) / 2,
      }
      applyResize(shape, sb, { left, top, right, bottom }, anchor)
      updateConns(shapes.value, new Set([g.id]))
    }
    store.dirty = true
    return
  }
  if (tool.value === 'select') {
    if (lastDrag && selectedIds.value.length) {
      // 帧增量：整体位移所有选中
      const dx = (e.clientX - lastDrag.x) / vp.currentScale()
      const dy = (e.clientY - lastDrag.y) / vp.currentScale()
      lastDrag = { x: e.clientX, y: e.clientY }
      if (dx || dy) {
        for (const id of selectedIds.value) {
          const shape = shapes.value.find((s) => s.id === id)
          if (shape) mergeTranslate(shape, dx, dy)
        }
        updateConns(shapes.value, new Set(selectedIds.value))
        store.dirty = true
      }
    } else if (marqueeStart && marquee.value) {
      const p = svgPoint(e)
      marquee.value = {
        x: Math.min(marqueeStart.x, p.x),
        y: Math.min(marqueeStart.y, p.y),
        w: Math.abs(p.x - marqueeStart.x),
        h: Math.abs(p.y - marqueeStart.y),
      }
    }
    return
  }
  if (tool.value === 'polygon') {
    // 橡皮筋预览：最新顶点到鼠标的连线
    if (polyPoints.value.length) polyHover.value = svgPoint(e)
    return
  }
  if (tool.value === 'spline' && draft.value) {
    // 终点吸附预览：命中即取离线起点最近的边中点（起点图形除外——禁止自连）
    const snap = snapAnchor(e, { x: Number(draft.value.attrs.x1), y: Number(draft.value.attrs.y1) })
    splineTo = snap && snap.id !== draft.value.connFrom ? snap.id : undefined
    const end = snap && splineTo !== undefined ? snap.pt : svgPoint(e)
    draft.value.attrs.x2 = String(round(end.x))
    draft.value.attrs.y2 = String(round(end.y))
    store.dirty = true
    return
  }
  if (!draft.value || !drawStart) return
  const p = svgPoint(e)
  const a = draft.value.attrs
  if (draft.value.kind === 'rect') {
    a.x = String(round(Math.min(drawStart.x, p.x)))
    a.y = String(round(Math.min(drawStart.y, p.y)))
    a.width = String(round(Math.abs(p.x - drawStart.x)))
    a.height = String(round(Math.abs(p.y - drawStart.y)))
  } else if (draft.value.kind === 'ellipse') {
    a.cx = String(round((drawStart.x + p.x) / 2))
    a.cy = String(round((drawStart.y + p.y) / 2))
    a.rx = String(round(Math.abs(p.x - drawStart.x) / 2))
    a.ry = String(round(Math.abs(p.y - drawStart.y) / 2))
  } else if (draft.value.kind === 'line') {
    a.x2 = String(round(p.x))
    a.y2 = String(round(p.y))
  } else {
    // 铅笔：点距过近去抖
    const last = pencilPoints[pencilPoints.length - 1] || ''
    const [lx, ly] = last.split(' ').map(Number) as [number, number]
    if (Math.abs(p.x - lx) > 2 || Math.abs(p.y - ly) > 2) {
      pencilPoints.push(`${round(p.x)} ${round(p.y)}`)
      a.d = 'M ' + pencilPoints.join(' L ')
    }
  }
  store.dirty = true
}

function onPointerUp(): void {
  panLast = null
  // resize 收口：零位移回滚本手势快照
  if (resizeGesture) {
    const moved = resizeGesture.moved
    resizeGesture = null
    if (!moved) hist.cancelLastSnapshot()
    return
  }
  // 橡皮擦收口：零删除回滚本手势快照
  if (erasing) {
    erasing = false
    if (!eraserRemoved) hist.cancelLastSnapshot()
  }
  if (tool.value === 'select') {
    // 框选收口：视觉 bbox 相交选中
    if (marqueeStart && marquee.value) {
      const hit = shapes.value.filter((s) => {
        const b = visualBBox(s.id)
        return (
          b &&
          b.left < marquee.value!.x + marquee.value!.w &&
          b.right > marquee.value!.x &&
          b.top < marquee.value!.y + marquee.value!.h &&
          b.bottom > marquee.value!.y
        )
      }).map((s) => s.id)
      selectedIds.value = marqueeShift ? [...new Set([...selectedIds.value, ...hit])] : hit
    }
    marquee.value = null
    marqueeStart = null
    lastDrag = null
    return
  }
  // 连接线收口：终点引用落定（自连排除；零长度取消由通用 trivial 判断承担）
  if (tool.value === 'spline' && draft.value) {
    draft.value.connTo = splineTo !== undefined && splineTo !== draft.value.connFrom ? splineTo : undefined
    splineTo = undefined
  }
  if (!draft.value) return
  const a = draft.value.attrs
  // 零尺寸误触丢弃：同步回滚撤销栈快照
  let trivial: boolean
  if (draft.value.kind === 'rect') trivial = Number(a.width) < 2 && Number(a.height) < 2
  else if (draft.value.kind === 'ellipse') trivial = Number(a.rx) < 1 && Number(a.ry) < 1
  else if (draft.value.kind === 'line') trivial = Math.abs(Number(a.x2) - Number(a.x1)) < 2 && Math.abs(Number(a.y2) - Number(a.y1)) < 2
  else trivial = pencilPoints.length < 2
  if (trivial) {
    hist.cancelLastSnapshot()
  } else {
    shapes.value = [...shapes.value, draft.value]
    selectedIds.value = [draft.value.id]
  }
  draft.value = null
  drawStart = null
}

// ── 文本 ─────────────────────────────────────────────────────────────────────

/** 点击画布放置文本（默认内容，立即进入浮层编辑） */
function placeText(p: { x: number; y: number }, client: { x: number; y: number }): void {
  snapshot()
  const shape: BoardShape = {
    id: nextId++,
    kind: 'text',
    attrs: {
      x: String(round(p.x)),
      y: String(round(p.y)),
      'font-size': '24',
      'font-family': 'sans-serif',
      fill: stroke.value,
    },
    text: '文本',
  }
  shapes.value = [...shapes.value, shape]
  selectedIds.value = [shape.id]
  store.dirty = true
  startEdit(shape, { x: client.x, y: client.y }, true)
}

/** 便签当前色（放置用；ctxBar 换色同步，连续放置同色） */
const stickyColor = ref(STICKY_COLORS[0]!)

/** 点击画布放置便签（中心落点击点，立即进入浮层编辑） */
function placeSticky(p: { x: number; y: number }, client: { x: number; y: number }): void {
  snapshot()
  const shape = createSticky(nextId++, p.x, p.y, stickyColor.value)
  shapes.value = [...shapes.value, shape]
  selectedIds.value = [shape.id]
  store.dirty = true
  // 编辑浮层定位到便签左上角（覆盖便签上部，对齐便签文本位置）
  const left = vp.clientFromSvg({ x: Number(shape.attrs.x), y: Number(shape.attrs.y) })
  startEdit(shape, { x: left.x + 4, y: left.y + 10 }, true)
}

/** 浮层定位（panel 相对坐标；已有文本用其 DOM bbox 左上角） */
function startEdit(shape: BoardShape, client: { x: number; y: number }, isNew: boolean): void {
  const panelBox = panelEl.value!.getBoundingClientRect()
  let x = client.x - panelBox.left
  let y = client.y - panelBox.top
  if (!isNew) {
    const el = canvasEl.value?.querySelector(`[data-shape-id="${shape.id}"]`)
    if (el) {
      const r = el.getBoundingClientRect()
      x = r.left - panelBox.left
      y = r.top - panelBox.top
    }
  }
  editBox.value = { id: shape.id, value: shape.text || '', x, y, isNew }
  void nextTick(() => editInput.value?.focus())
}

function confirmEdit(): void {
  const eb = editBox.value
  if (!eb) return
  editBox.value = null
  const shape = shapes.value.find((s) => s.id === eb.id)
  if (!shape) return
  const value = eb.value.trim()
  if (!value) {
    // 空文本：新放置的删除，已有文本保持原内容
    if (eb.isNew) shapes.value = shapes.value.filter((s) => s.id !== eb.id)
    return
  }
  snapshot()
  shape.text = value
  store.dirty = true
}

function cancelEdit(): void {
  const eb = editBox.value
  if (!eb) return
  editBox.value = null
  if (eb.isNew) shapes.value = shapes.value.filter((s) => s.id !== eb.id)
}

/** 双击：多边形工具下闭合收口，其余命中文本进入编辑 */
function onDblclick(e: MouseEvent): void {
  if (tool.value === 'polygon') {
    commitPolygon()
    return
  }
  const hit = hitShapeAt(e.clientX, e.clientY)
  if (!hit) return
  const shape = shapes.value.find((s) => s.id === Number(hit.getAttribute('data-shape-id')))
  if (shape?.kind === 'text' || shape?.kind === 'sticky') startEdit(shape, { x: e.clientX, y: e.clientY }, false)
}

// ── 对齐 / 编组 / 删除 ───────────────────────────────────────────────────────

type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 对齐：单选对画布、多选互对齐（基准 = 选区联合 bbox） */
function align(mode: AlignMode): void {
  const ids = selectedIds.value
  if (!ids.length) return
  const boxes = ids.map((id) => ({ id, b: visualBBox(id) }))
  if (boxes.some((x) => !x.b)) return
  // "对画布"是文档语义：基准 = 文档边界（非当前视口）
  const canvasBox = { left: docBox.value.x, top: docBox.value.y, right: docBox.value.x + docBox.value.w, bottom: docBox.value.y + docBox.value.h }
  const base =
    ids.length === 1
      ? canvasBox
      : {
          left: Math.min(...boxes.map((x) => x.b!.left)),
          top: Math.min(...boxes.map((x) => x.b!.top)),
          right: Math.max(...boxes.map((x) => x.b!.right)),
          bottom: Math.max(...boxes.map((x) => x.b!.bottom)),
        }
  snapshot()
  for (const { id, b } of boxes) {
    const dx =
      mode === 'left' ? base.left - b!.left
      : mode === 'hcenter' ? (base.left + base.right) / 2 - (b!.left + b!.right) / 2
      : mode === 'right' ? base.right - b!.right
      : 0
    const dy =
      mode === 'top' ? base.top - b!.top
      : mode === 'vcenter' ? (base.top + base.bottom) / 2 - (b!.top + b!.bottom) / 2
      : mode === 'bottom' ? base.bottom - b!.bottom
      : 0
    const shape = shapes.value.find((s) => s.id === id)
    if (shape) mergeTranslate(shape, dx, dy)
  }
  updateConns(shapes.value, new Set(ids))
  store.dirty = true
}

/** 编组：选中顶层对象合并为单层 group（含 group 时展平，不嵌套） */
function groupSelected(): void {
  if (selectedIds.value.length < 2) return
  snapshot()
  const members = shapes.value.filter((s) => selectedIds.value.includes(s.id))
  const children = members.flatMap((m) => (m.kind === 'group' ? m.children || [] : [m]))
  const rest = shapes.value.filter((s) => !selectedIds.value.includes(s.id))
  const group: BoardShape = { id: nextId++, kind: 'group', attrs: {}, children }
  shapes.value = [...rest, group]
  // 成员被吞入 group：引用成员的连接线悬空脱离（首版不做迁移）
  updateConns(shapes.value, new Set())
  selectedIds.value = [group.id]
  store.dirty = true
}

/** 解组：children 平铺回顶层，group 的 translate 落到各 child 保持视觉位置 */
function ungroupSelected(): void {
  const groups = shapes.value.filter((s) => s.kind === 'group' && selectedIds.value.includes(s.id))
  if (!groups.length) return
  snapshot()
  const rest = shapes.value.filter((s) => !(s.kind === 'group' && selectedIds.value.includes(s.id)))
  const flat: BoardShape[] = []
  for (const g of groups) {
    for (const c of g.children || []) {
      // group 位移并入 child 的 translate（非 translate 变换首版不支持，直接覆盖）
      const gt = parseTranslate(g.attrs.transform)
      if (gt.x || gt.y) mergeTranslate(c, gt.x, gt.y)
      flat.push(c)
    }
  }
  shapes.value = [...rest, ...flat]
  // child 视觉位移 / group id 消失：连接线跟随或悬空脱离
  updateConns(shapes.value, new Set(flat.map((s) => s.id)))
  selectedIds.value = flat.map((s) => s.id)
  store.dirty = true
}

function deleteSelected(): void {
  if (!selectedIds.value.length) return
  snapshot()
  shapes.value = shapes.value.filter((s) => !selectedIds.value.includes(s.id))
  selectedIds.value = []
  // 引用被删目标的连接线悬空脱离
  updateConns(shapes.value, new Set())
  store.dirty = true
}

/** 橡皮擦命中删除（group 整删；首次删除前快照一次） */
function eraseAt(e: PointerEvent): void {
  const hit = hitShapeAt(e.clientX, e.clientY)
  if (!hit) return
  const id = Number(hit.getAttribute('data-shape-id'))
  if (!shapes.value.some((s) => s.id === id)) return
  if (!eraserSnapped) {
    snapshot()
    eraserSnapped = true
  }
  shapes.value = shapes.value.filter((s) => s.id !== id)
  selectedIds.value = selectedIds.value.filter((x) => x !== id)
  // 引用被删目标的连接线悬空脱离
  updateConns(shapes.value, new Set())
  eraserRemoved = true
  store.dirty = true
}

// ── 图层顺序（shapes 数组顺序即 z 序，后渲染在上）────────────────────────────

type ReorderMode = 'up' | 'down' | 'front' | 'back'

/** 图层移动：front/back 选中块移到端部；up/down 选中元素与相邻非选中逐位交换
 * （从移动方向前缘扫描，多选连续块整体移动保内部相对序） */
function reorderSelected(mode: ReorderMode): void {
  const ids = selectedIds.value
  if (!ids.length) return
  const list = shapes.value
  const sel = list.filter((s) => ids.includes(s.id))
  if (!sel.length) return
  snapshot()
  if (mode === 'front') {
    shapes.value = [...list.filter((s) => !ids.includes(s.id)), ...sel]
  } else if (mode === 'back') {
    shapes.value = [...sel, ...list.filter((s) => !ids.includes(s.id))]
  } else {
    const next = [...list]
    const step = mode === 'up' ? 1 : -1
    const idxs = mode === 'up' ? [...next.keys()].reverse() : [...next.keys()]
    for (const i of idxs) {
      if (!ids.includes(next[i]!.id)) continue
      const j = i + step
      if (j < 0 || j >= next.length || ids.includes(next[j]!.id)) continue
      ;[next[i], next[j]] = [next[j]!, next[i]!]
    }
    shapes.value = next
  }
  store.dirty = true
}

// ── 剪贴板 / 方向键微移 ─────────────────────────────────────────────────────

/** 粘贴：剪贴板内容 id 重分配后追加并选中（粘贴件整体偏移，连接线端点随吸附重算） */
function doPaste(): void {
  const pasted = paste(() => nextId++)
  if (!pasted.length) return
  snapshot()
  shapes.value = [...shapes.value, ...pasted]
  updateConns(shapes.value, new Set(pasted.map((s) => s.id)))
  selectedIds.value = pasted.map((s) => s.id)
  store.dirty = true
}

/** 再制：复制当前选中并立即粘贴（偏移错位） */
function doDuplicate(): void {
  if (!selectedIds.value.length) return
  if (!copySelection(shapes.value, selectedIds.value)) return
  doPaste()
}

/** 方向键微移快照合并标志（连续按键只快照一次，500ms 静默复位） */
let arrowSnapTimer: ReturnType<typeof setTimeout> | null = null
let arrowSnapped = false

function arrowMove(dx: number, dy: number): void {
  if (!arrowSnapped) {
    snapshot()
    arrowSnapped = true
  }
  if (arrowSnapTimer) clearTimeout(arrowSnapTimer)
  arrowSnapTimer = setTimeout(() => {
    arrowSnapped = false
  }, 500)
  for (const id of selectedIds.value) {
    const s = shapes.value.find((x) => x.id === id)
    if (s) mergeTranslate(s, dx, dy)
  }
  updateConns(shapes.value, new Set(selectedIds.value))
  store.dirty = true
}

function onKeydown(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  // 拉伸手势进行中：屏蔽全部快捷键（防 undo/删除打断手势状态）
  if (resizeGesture) return
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.value.length) {
    e.preventDefault()
    deleteSelected()
  } else if (e.key === 'Enter' && polyPoints.value.length) {
    // 多边形绘制中：回车闭合
    e.preventDefault()
    commitPolygon()
  } else if (e.key === 'Escape') {
    // 优先级链：绘制中丢弃 → 取消选择 → 关形状库浮层
    if (polyPoints.value.length) {
      polyPoints.value = []
      polyHover.value = null
    } else if (selectedIds.value.length) {
      selectedIds.value = []
    } else if (shapesOpen.value) {
      shapesOpen.value = false
    }
  } else if (mod && key === 'z') {
    e.preventDefault()
    // 先判 shift：⇧⌘Z 重做，⌘Z 撤销
    if (e.shiftKey) redo()
    else undo()
  } else if (mod && key === 'g') {
    e.preventDefault()
    if (e.shiftKey) ungroupSelected()
    else groupSelected()
  } else if (mod && key === 's') {
    e.preventDefault()
    void save()
  } else if (mod && key === 'a') {
    // 全选（顶层图形）
    e.preventDefault()
    selectedIds.value = shapes.value.map((s) => s.id)
  } else if (mod && key === 'c') {
    // 应用内复制（有选中才拦截，否则放行系统剪贴板）
    if (copySelection(shapes.value, selectedIds.value)) e.preventDefault()
  } else if (mod && key === 'v') {
    if (hasClip()) {
      e.preventDefault()
      doPaste()
    }
  } else if (mod && key === 'd') {
    e.preventDefault()
    doDuplicate()
  } else if (mod && key === ']') {
    e.preventDefault()
    reorderSelected(e.shiftKey ? 'front' : 'up')
  } else if (mod && key === '[') {
    e.preventDefault()
    reorderSelected(e.shiftKey ? 'back' : 'down')
  } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
    // 工具快捷键（无修饰键）
    tool.value = TOOL_KEYS[key]!
  } else if (e.key.startsWith('Arrow') && selectedIds.value.length) {
    // 方向键微移：1px，Shift 10px
    e.preventDefault()
    const stepLen = e.shiftKey ? 10 : 1
    const dx = e.key === 'ArrowRight' ? stepLen : e.key === 'ArrowLeft' ? -stepLen : 0
    const dy = e.key === 'ArrowDown' ? stepLen : e.key === 'ArrowUp' ? -stepLen : 0
    arrowMove(dx, dy)
  } else if (e.code === 'Space' && !e.repeat) {
    // 空格按住临时平移画布（keyup 复位；输入框聚焦已在函数头排除）
    e.preventDefault()
    spaceDown.value = true
  }
}

/** 工具快捷键映射（无修饰键；v 选择 / h 平移 / r 矩形 / o 椭圆 / l 直线 / p 铅笔 / t 文本 / n 便签 / c 连接线 / e 橡皮） */
const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  c: 'spline',
  p: 'pencil',
  t: 'text',
  n: 'sticky',
  e: 'eraser',
}

/** 空格抬起复位平移态 */
function onKeyup(e: KeyboardEvent): void {
  if (e.code === 'Space') spaceDown.value = false
}

/** 滚轮缩放：以鼠标位置为锚点（触摸板 pinch 合成 ctrlKey 同路径） */
function onWheel(e: WheelEvent): void {
  vp.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015))
}

/** 适应内容：视口设为内容 ∪ 文档（外扩 10%） */
function fitContent(): void {
  vp.fitTo(contentBox.value)
}

// ── 小地图：内容联合 bbox（纯 attrs 解析，不读 DOM）──────────────────────────

/** 全部图形的联合 bbox（minimap 世界范围与适应内容共用） */
const contentBox = ref<View | null>(null)

function updateContentBox(): void {
  let u: View | null = null
  for (const s of shapes.value) {
    const b = shapeBBox(s)
    if (!b) continue
    const v = { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top }
    u = unionView(u, v)
  }
  contentBox.value = u
}

// 不读 DOM，无需 flush post；deep 跟随拖动/缩放等 attrs 变化
watch(shapes, updateContentBox, { deep: true })

/** 小地图导航：视口中心移到指定 svg 坐标 */
function onMinimapNavigate(p: { x: number; y: number }): void {
  view.value = { ...view.value, x: p.x - view.value.w / 2, y: p.y - view.value.h / 2 }
}

// 画布序列化器登记：「添加到对话」先落盘再引用时取当前画布文本（卸载注销）
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  store.serializer = () => serialize()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  store.serializer = null
})

// 切换工具时收口进行中的多边形（<3 点静默丢弃）
watch(tool, () => {
  if (polyPoints.value.length) commitPolygon()
})

// ── 序列化 / 导入 ────────────────────────────────────────────────────────────

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function attrString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ')
}

function serializeShape(s: BoardShape): string {
  // data-shape-id 输出给重导入引用重写（连接线 data-conn-* 依据）
  const idAttr = ` data-shape-id="${s.id}"`
  if (s.kind === 'text') return `<text${idAttr} ${attrString(s.attrs)}>${esc(s.text || '')}</text>`
  if (s.kind === 'sticky') {
    // 便签语义标记：外部查看器按普通 g 渲染（rect + text 视觉），导入时识别恢复语义
    const inner = [
      `<rect ${attrString(stickyRectAttrs(s))}/>`,
      `<text ${attrString(stickyTextAttrs(s))}>${esc(s.text || '')}</text>`,
    ].join('\n    ')
    const t = s.attrs.transform ? ` ${attrString({ transform: s.attrs.transform })}` : ''
    return `<g data-svgboard="sticky"${idAttr}${t}>\n    ${inner}\n  </g>`
  }
  if (s.kind === 'group') {
    const body = (s.children || []).map(serializeShape).join('\n    ')
    return `<g${idAttr} ${attrString(s.attrs)}>\n    ${body}\n  </g>`
  }
  if (s.kind === 'line') {
    const conn = [
      s.connFrom !== undefined ? ` data-conn-from="${s.connFrom}"` : '',
      s.connTo !== undefined ? ` data-conn-to="${s.connTo}"` : '',
    ].join('')
    return `<line${idAttr} ${attrString(s.attrs)}${conn}/>`
  }
  return `<${s.kind}${idAttr} ${attrString(s.attrs)}/>`
}

function serialize(): string {
  const body = shapes.value.map(serializeShape).join('\n  ')
  // viewBox 用文档边界（非当前视口）：当前视口不得污染落盘文件
  const v = docBox.value
  // 首元素固定白底 rect（画板底色即白色，落盘文件在任意查看器中同为白底；
  // 导入时按 id 跳过，不进入图形列表）
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.x} ${v.y} ${v.w} ${v.h}">\n  <rect id="svgboard-bg" x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="#ffffff"/>\n  ${body}\n</svg>\n`
}

/** g 的 transform 仅保留纯 translate（其余变换首版不支持，丢弃并提示于头注） */
function translateOnly(transform: string | null): string {
  if (!transform) return ''
  const m = /^translate\(([-\d.]+)[ ,]([-\d.]+)\)$/.exec(transform.trim())
  return m ? `translate(${m[1]} ${m[2]})` : ''
}

/** 原始 id 登记映射（serialize 输出 data-shape-id，重导入时连接引用重写依据） */
function registerId(rawId: number, newId: number, idMap: Map<number, number>): void {
  if (Number.isFinite(rawId) && rawId > 0) idMap.set(rawId, newId)
}

/** SVG 文本导入：递归解析（g → 单层 group；text 取 textContent；idMap 登记原始→新 id） */
function importNode(el: Element, idMap: Map<number, number>): BoardShape | null {
  const kind = el.tagName
  const base: BoardShape = { id: nextId++, kind: 'path', attrs: {}, text: undefined, children: undefined }
  if (kind === 'g') {
    // 便签语义标记：rect 承载几何，text 承载内容（标记存在但无 rect 时退化为普通 group）
    if (el.getAttribute('data-svgboard') === 'sticky') {
      const rect = el.querySelector('rect')
      if (rect) {
        const attrs: Record<string, string> = {}
        for (const name of rect.getAttributeNames()) attrs[name] = rect.getAttribute(name) || ''
        const t = translateOnly(el.getAttribute('transform'))
        if (t) attrs.transform = t
        registerId(Number(el.getAttribute('data-shape-id')), base.id, idMap)
        return { ...base, kind: 'sticky', attrs, text: el.querySelector('text')?.textContent || '' }
      }
    }
    const children = Array.from(el.children)
      .map((c) => importNode(c, idMap))
      .filter((x): x is BoardShape => x !== null)
    if (!children.length) return null
    const t = translateOnly(el.getAttribute('transform'))
    const g: BoardShape = { ...base, kind: 'group', attrs: t ? { transform: t } : {}, children }
    registerId(Number(el.getAttribute('data-shape-id')), g.id, idMap)
    return g
  }
  const attrs: Record<string, string> = {}
  for (const name of el.getAttributeNames()) attrs[name] = el.getAttribute(name) || ''
  // 自绘白底 rect（serialize 注入）不属于图形内容
  if (kind === 'rect' && attrs.id === 'svgboard-bg') return null
  // 内部标记不进图形 attrs：data-shape-id 由渲染模板注入，conn 引用走顶层字段
  const rawId = Number(attrs['data-shape-id'])
  const connFromRaw = Number(attrs['data-conn-from'])
  const connToRaw = Number(attrs['data-conn-to'])
  delete attrs['data-shape-id']
  delete attrs['data-svgboard']
  delete attrs['data-conn-from']
  delete attrs['data-conn-to']
  // 收口：登记 id 映射 + 连接引用暂存（原始 id，importSvg 内按映射重写）
  const finish = (shape: BoardShape): BoardShape => {
    registerId(rawId, shape.id, idMap)
    if (Number.isFinite(connFromRaw) && connFromRaw > 0) shape.connFrom = connFromRaw
    if (Number.isFinite(connToRaw) && connToRaw > 0) shape.connTo = connToRaw
    return shape
  }
  if (kind === 'text') {
    return finish({ ...base, kind: 'text', attrs: { ...attrs, 'font-family': attrs['font-family'] || 'sans-serif' }, text: (el.textContent || '').trim() || ' ' })
  }
  if (kind === 'circle') {
    // circle → ellipse 统一基元
    const r = attrs.r || '0'
    attrs.rx = r
    attrs.ry = r
    attrs.cx = attrs.cx || '0'
    attrs.cy = attrs.cy || '0'
    delete attrs.r
  }
  if (kind === 'polyline') {
    // polyline（不闭合）→ path d 统一基元
    const pts = (attrs.points || '').trim().split(/[\s,]+/).filter(Boolean)
    if (pts.length < 4 || pts.length % 2 !== 0) return null
    let d = `M ${pts[0]} ${pts[1]}`
    for (let i = 2; i < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`
    attrs.d = d
    delete attrs.points
    return finish({ ...base, kind: 'path', attrs })
  }
  if (kind === 'polygon') {
    // polygon 保留基元（≥3 个顶点；与多边形工具的原生形态一致）
    const n = (attrs.points || '').trim().split(/[\s,]+/).filter(Boolean).length
    if (n < 6 || n % 2 !== 0) return null
    return finish({ ...base, kind: 'polygon', attrs })
  }
  if (kind === 'rect' || kind === 'ellipse' || kind === 'line' || kind === 'path') {
    return finish({ ...base, kind, attrs })
  }
  return null
}

/** 连接引用重写：原始 id → 新 id（悬空脱离为自由线；group 内嵌线同样处理） */
function rewriteConns(s: BoardShape, idMap: Map<number, number>): void {
  if (s.connFrom !== undefined) {
    const m = idMap.get(s.connFrom)
    if (m !== undefined) s.connFrom = m
    else delete s.connFrom
  }
  if (s.connTo !== undefined) {
    const m = idMap.get(s.connTo)
    if (m !== undefined) s.connTo = m
    else delete s.connTo
  }
  for (const c of s.children || []) rewriteConns(c, idMap)
}

function importSvg(text: string): boolean {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return false
  const root = doc.documentElement
  const vbAttr = root.getAttribute('viewBox')
  if (vbAttr) {
    const n = vbAttr.trim().split(/[\s,]+/).map(Number)
    if (n.length === 4 && n.every((x) => Number.isFinite(x))) {
      docBox.value = { x: n[0]!, y: n[1]!, w: n[2]!, h: n[3]! }
    }
  } else {
    const w = Number(root.getAttribute('width')) || 1000
    const h = Number(root.getAttribute('height')) || 700
    docBox.value = { x: 0, y: 0, w, h }
  }
  // 导入后视口重置到文档边界（新会话从全貌开始）
  view.value = { ...docBox.value }
  const idMap = new Map<number, number>()
  const collected: BoardShape[] = []
  for (const child of Array.from(root.children)) {
    const shape = importNode(child, idMap)
    if (shape) collected.push(shape)
  }
  // 连接引用按原始 id 映射重写（悬空脱离为自由线）
  for (const s of collected) rewriteConns(s, idMap)
  shapes.value = collected
  return true
}

// ── store 接线：打开交接 / 保存 ──────────────────────────────────────────────

watch(
  () => store.pendingText,
  (text) => {
    if (!text) return
    store.pendingText = ''
    nextId = 1
    hist.clear()
    selectedIds.value = []
    editBox.value = null
    if (!importSvg(text)) ElMessage.warning('SVG 解析失败，已打开空白画板')
  }
)

async function save(): Promise<void> {
  const ok = await store.save(serialize())
  if (ok) ElMessage.success('已保存')
}

/** 导出 PNG：当前画布 2x 白底渲染 → 系统对话框选路径落盘 */
async function exportPngAction(): Promise<void> {
  try {
    const dataUrl = await exportPng(serialize(), docBox.value)
    const ok = await store.savePng(dataUrl)
    if (ok) ElMessage.success('已导出 PNG')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  }
}

/** 头部文件名 */
const fileName = computed(() => store.currentFile.split('/').pop() || '未命名画板')

/** 多边形绘制预览：已落顶点 + 鼠标橡皮筋点 */
const polyPreviewPts = computed(() => {
  const pts = polyPoints.value.map((pt) => `${round(pt.x)} ${round(pt.y)}`)
  if (polyHover.value) pts.push(`${round(polyHover.value.x)} ${round(polyHover.value.y)}`)
  return pts.join(' ')
})

const TOOLS: { id: Tool; icon: string; tip: string }[] = [
  { id: 'select', icon: 'lucide:mouse-pointer-2', tip: '选择/移动（Shift 多选，空白拖动框选）' },
  { id: 'hand', icon: 'lucide:hand', tip: '平移画布（或按住空格拖拽）' },
  { id: 'rect', icon: 'lucide:square', tip: '矩形' },
  { id: 'ellipse', icon: 'lucide:circle', tip: '椭圆' },
  { id: 'line', icon: 'lucide:minus', tip: '直线' },
  { id: 'spline', icon: 'lucide:spline', tip: '连接线（拖到图形上自动吸附边中点）' },
  { id: 'polygon', icon: 'lucide:hexagon', tip: '多边形（依次点击落点，双击/回车/点回起点闭合）' },
  { id: 'pencil', icon: 'lucide:pencil', tip: '自由绘制' },
  { id: 'text', icon: 'lucide:type', tip: '文本（点击放置，双击已有文本编辑）' },
  { id: 'sticky', icon: 'lucide:sticky-note', tip: '便签（点击放置，双击再编辑）' },
  { id: 'eraser', icon: 'lucide:eraser', tip: '橡皮擦（点击或拖过删除）' },
]

const ALIGNS: { id: AlignMode; icon: string; tip: string }[] = [
  { id: 'left', icon: 'lucide:align-start-vertical', tip: '左对齐' },
  { id: 'hcenter', icon: 'lucide:align-center-vertical', tip: '水平居中' },
  { id: 'right', icon: 'lucide:align-end-vertical', tip: '右对齐' },
  { id: 'top', icon: 'lucide:align-start-horizontal', tip: '顶对齐' },
  { id: 'vcenter', icon: 'lucide:align-center-horizontal', tip: '垂直居中' },
  { id: 'bottom', icon: 'lucide:align-end-horizontal', tip: '底对齐' },
]

/** 图层移动四向（数组顺序即 z 序） */
const REORDERS: { id: ReorderMode; icon: string; tip: string }[] = [
  { id: 'up', icon: 'lucide:move-up', tip: '上移一层 (⌘])' },
  { id: 'down', icon: 'lucide:move-down', tip: '下移一层 (⌘[)' },
  { id: 'front', icon: 'lucide:bring-to-front', tip: '置顶 (⇧⌘])' },
  { id: 'back', icon: 'lucide:send-to-back', tip: '置底 (⇧⌘[)' },
]

// ── 预设形状库 ───────────────────────────────────────────────────────────────

const shapesOpen = ref(false)

/** 分类分组 + 预览标记（预设静态，面板打开期间不变） */
const presetGroups = PRESET_CATEGORIES.map((cat) => ({
  ...cat,
  items: SHAPE_PRESETS.filter((p) => p.category === cat.id).map((p) => ({
    ...p,
    markup: previewMarkup(p),
  })),
}))

/** 连续放置的错位步进（避免多次放置全部叠在视口中心） */
let placeShift = 0

/** 放置预设：几何以原点生成，平移到当前视口中心；单元素直落，元素组成单层 group */
function placePreset(p: ShapePreset): void {
  snapshot()
  const style = shapeAttrs()
  const step = (placeShift++ % 6) * 28
  // 放到当前视野中心（缩放平移后仍落眼中）
  const tx = round(view.value.x + (view.value.w - p.w) / 2 + step)
  const ty = round(view.value.y + (view.value.h - p.h) / 2 + step)
  const built = p.build(style)
  let shape: BoardShape
  if (Array.isArray(built)) {
    const children = built.map((el) => ({ id: nextId++, kind: el.kind, attrs: { ...style, ...el.attrs } }) as BoardShape)
    shape = { id: nextId++, kind: 'group', attrs: { transform: `translate(${tx} ${ty})` }, children }
  } else {
    shape = { id: nextId++, kind: built.kind, attrs: { ...style, ...built.attrs, transform: `translate(${tx} ${ty})` } }
  }
  shapes.value = [...shapes.value, shape]
  selectedIds.value = [shape.id]
  store.dirty = true
}

// ── 选中属性工具栏（上下文浮层：单选时出现在选区上方）────────────────────────

const ctxBar = ref<{ x: number; y: number } | null>(null)
/** 更改图形网格展开态 */
const ctxShapesOpen = ref(false)
/** 选区视觉 bbox（resize 柄定位基准，updateCtxBar 顺带维护） */
const selBox = ref<BBox | null>(null)
/** 色值连续修改只快照一次的标志（@change 复位） */
let colorSnapDone = false

/** 可用于「更改图形」的预设：单元素形态（group 形态试跑排除）+ 预览标记 */
const CHANGEABLE_PRESETS = SHAPE_PRESETS.filter((p) => {
  const built = p.build({ stroke: '#000', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' })
  return !Array.isArray(built)
}).map((p) => ({ ...p, markup: previewMarkup(p) }))

/** 当前单选图形（工具栏内容随其 kind/attrs 渲染） */
const ctxShape = computed(() => selectedShape())

function selectedShape(): BoardShape | null {
  if (selectedIds.value.length !== 1) return null
  return shapes.value.find((s) => s.id === selectedIds.value[0]) || null
}

/** 选区视觉 bbox 中心 → panel 相对坐标（工具栏悬挂点）；顺带维护 selBox */
function updateCtxBar(): void {
  const s = selectedShape()
  if (!s || editBox.value) {
    ctxBar.value = null
    ctxShapesOpen.value = false
    selBox.value = null
    return
  }
  const b = visualBBox(s.id)
  if (!b || !panelEl.value || !canvasEl.value) {
    ctxBar.value = null
    selBox.value = null
    return
  }
  const panelBox = panelEl.value.getBoundingClientRect()
  // 选区上沿中点 → client → panel 相对坐标（缩放平移后跟随）
  const anchor = vp.clientFromSvg({ x: (b.left + b.right) / 2, y: b.top })
  ctxBar.value = { x: anchor.x - panelBox.left, y: anchor.y - panelBox.top }
  selBox.value = b
}

// flush post：DOM 更新后再取视觉 bbox（放置/导入后同 tick 即可定位）
watch(selectedIds, updateCtxBar, { flush: 'post' })
// 拖动/改属性都会改 shapes（mergeTranslate 帧 merge），deep watch 让工具栏跟随
watch(shapes, updateCtxBar, { deep: true, flush: 'post' })
watch(
  editBox,
  (v) => {
    if (v) ctxBar.value = null
    else updateCtxBar()
  },
  { flush: 'post' }
)

// ── resize 拉伸柄位置（单选渲染；尺寸除以 scale 保证屏幕恒定大小）────────────

const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 柄方向 → cursor 样式类名（CSS Modules 禁内联样式，走类名映射） */
function handleCur(h: HandleId): string {
  if (h === 'nw' || h === 'se') return 'curNwse'
  if (h === 'ne' || h === 'sw') return 'curNesw'
  if (h === 'n' || h === 's') return 'curNs'
  if (h === 'e' || h === 'w') return 'curEw'
  return 'curMove'
}

/** 八向 bbox 柄（line 走端点柄；text 仅四角：text resize 只做左下锚定缩放）。
 * 引用 view.value 建立缩放响应依赖（currentScale 读 DOM 不触发重算）。 */
const handleRects = computed(() => {
  void view.value
  const s = selectedShape()
  if (!s || tool.value !== 'select' || editBox.value || !selBox.value || s.kind === 'line') return []
  const ids = s.kind === 'text' ? HANDLES.filter((h) => h.length === 2) : HANDLES
  const hs = 8 / vp.currentScale()
  const b = selBox.value
  return ids.map((h) => {
    const cx = h.includes('w') ? b.left : h.includes('e') ? b.right : (b.left + b.right) / 2
    const cy = h.includes('n') ? b.top : h.includes('s') ? b.bottom : (b.top + b.bottom) / 2
    return { handle: h, x: round(cx - hs / 2), y: round(cy - hs / 2), size: round(hs), cur: handleCur(h) }
  })
})

/** line 端点柄（圆形，拖拽直接改端点 attrs） */
const lineHandles = computed(() => {
  void view.value
  const s = selectedShape()
  if (!s || s.kind !== 'line' || tool.value !== 'select' || editBox.value) return []
  const t = parseTranslate(s.attrs.transform)
  const n = (v: string | undefined): number => Number(v) || 0
  const r = 5 / vp.currentScale()
  return [
    { handle: 'p1' as const, cx: n(s.attrs.x1) + t.x, cy: n(s.attrs.y1) + t.y, r },
    { handle: 'p2' as const, cx: n(s.attrs.x2) + t.x, cy: n(s.attrs.y2) + t.y, r },
  ]
})

/** 实时改选中图形属性（色值拖动：首次快照一次，@change 复位标志） */
function liveAttrs(patch: Record<string, string>): void {
  const s = selectedShape()
  if (!s) return
  if (!colorSnapDone) {
    snapshot()
    colorSnapDone = true
  }
  Object.assign(s.attrs, patch)
  store.dirty = true
}

/** 色值事件 handler（模板不内联 target 断言） */
function liveFill(e: Event): void {
  liveAttrs({ fill: (e.target as HTMLInputElement).value })
}

function liveStroke(e: Event): void {
  liveAttrs({ stroke: (e.target as HTMLInputElement).value })
}

function resetColorSnap(): void {
  colorSnapDone = false
}

/** 填充切换（离散操作）：none 与取色器当前值互切 */
function toggleFillCtx(): void {
  const s = selectedShape()
  if (!s) return
  patchAttrs({ fill: s.attrs.fill === 'none' ? fillPick.value : 'none' })
}

/** 字号修改（text 单选） */
function setFontSize(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  patchAttrs({ 'font-size': String(Number.isFinite(v) && v >= 8 ? Math.round(v) : 24) })
}

/** 离散属性修改（线宽/填充切换/字号）：每次快照 */
function patchAttrs(patch: Record<string, string>): void {
  const s = selectedShape()
  if (!s) return
  snapshot()
  Object.assign(s.attrs, patch)
  store.dirty = true
}

/** 更改图形：保留描边/填充样式，以原视觉中心放置新预设几何 */
function changeShape(p: ShapePreset): void {
  const s = selectedShape()
  if (!s || s.kind === 'group' || s.kind === 'text' || s.kind === 'sticky') return
  const b = visualBBox(s.id)
  if (!b) return
  snapshot()
  const style = {
    stroke: s.attrs.stroke || stroke.value,
    'stroke-width': s.attrs['stroke-width'] || String(width.value),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    fill: s.attrs.fill || 'none',
  }
  const built = p.build(style)
  if (Array.isArray(built)) return
  const cx = (b.left + b.right) / 2
  const cy = (b.top + b.bottom) / 2
  s.kind = built.kind
  s.attrs = { ...style, ...built.attrs, transform: `translate(${round(cx - p.w / 2)} ${round(cy - p.h / 2)})` }
  ctxShapesOpen.value = false
  store.dirty = true
}
</script>

<template>
  <div ref="panelEl" :class="$style.panel">
    <!-- 工具行：工具组 + 颜色 + 线宽 + 对齐 + 编组 + 撤销 + 保存 -->
    <div :class="$style.toolbar">
      <div :class="$style.group">
        <button
          v-for="t in TOOLS"
          :key="t.id"
          type="button"
          :class="[$style.toolBtn, { [$style.toolActive]: tool === t.id }]"
          :aria-label="t.tip"
          :title="t.tip"
          @click="tool = t.id"
        >
          <MxIcon :name="t.icon" :size="16" />
        </button>
        <button
          type="button"
          :class="[$style.toolBtn, { [$style.toolActive]: shapesOpen }]"
          aria-label="形状库"
          title="形状库（点击预设图形放置到画布中心）"
          @click="shapesOpen = !shapesOpen"
        >
          <MxIcon name="lucide:shapes" :size="16" />
        </button>
      </div>
      <div :class="$style.group">
        <label :class="$style.colorBtn" title="描边颜色">
          <span :class="$style.colorDot" :style="{ background: stroke }" />
          <input v-model="stroke" type="color" :class="$style.colorInput" />
        </label>
        <label :class="[$style.colorBtn, { [$style.fillOff]: fill === 'none' }]" title="填充颜色">
          <span :class="$style.colorDot" :style="{ background: fillPick }" />
          <input v-model="fillPick" type="color" :class="$style.colorInput" @input="fill = fillPick" />
        </label>
        <button
          type="button"
          :class="[$style.toolBtn, { [$style.toolActive]: fill !== 'none' }]"
          aria-label="填充切换"
          title="填充：有 / 无"
          @click="toggleFill"
        >
          <MxIcon name="lucide:paintbrush" :size="16" />
        </button>
        <button
          v-for="w in WIDTHS"
          :key="w"
          type="button"
          :class="[$style.toolBtn, { [$style.toolActive]: width === w }]"
          :aria-label="`线宽 ${w}`"
          :title="`线宽 ${w}`"
          @click="width = w"
        >
          <span :class="$style.widthDot" :style="{ height: w + 2 + 'px', width: w + 2 + 'px' }" />
        </button>
      </div>
      <div :class="$style.group">
        <button
          v-for="al in ALIGNS"
          :key="al.id"
          type="button"
          :class="$style.toolBtn"
          :disabled="selectedIds.length === 0"
          :aria-label="al.tip"
          :title="al.tip + (selectedIds.length > 1 ? '（选区互对齐）' : '（对画布）')"
          @click="align(al.id)"
        >
          <MxIcon :name="al.icon" :size="16" />
        </button>
      </div>
      <div :class="$style.group">
        <button
          v-for="re in REORDERS"
          :key="re.id"
          type="button"
          :class="$style.toolBtn"
          :disabled="selectedIds.length === 0"
          :aria-label="re.tip"
          :title="re.tip"
          @click="reorderSelected(re.id)"
        >
          <MxIcon :name="re.icon" :size="16" />
        </button>
      </div>
      <div :class="$style.group">
        <button
          type="button"
          :class="$style.toolBtn"
          :disabled="selectedIds.length < 2"
          aria-label="编组"
          title="编组 (⌘G)"
          @click="groupSelected"
        >
          <MxIcon name="lucide:group" :size="16" />
        </button>
        <button
          type="button"
          :class="$style.toolBtn"
          :disabled="!selectedIds.some((id) => shapes.find((s) => s.id === id)?.kind === 'group')"
          aria-label="解组"
          title="解组 (⇧⌘G)"
          @click="ungroupSelected"
        >
          <MxIcon name="lucide:ungroup" :size="16" />
        </button>
        <button
          type="button"
          :class="$style.toolBtn"
          aria-label="重做"
          title="重做 (⇧⌘Z)"
          :disabled="!hist.canRedo()"
          @click="redo"
        >
          <MxIcon name="lucide:redo-2" :size="16" />
        </button>
        <button
          type="button"
          :class="$style.toolBtn"
          aria-label="撤销"
          title="撤销 (⌘Z)"
          :disabled="!hist.canUndo()"
          @click="undo"
        >
          <MxIcon name="lucide:undo-2" :size="16" />
        </button>
        <button
          type="button"
          :class="$style.toolBtn"
          aria-label="导出 PNG"
          title="导出 PNG（2x 白底，系统对话框选路径）"
          @click="exportPngAction"
        >
          <MxIcon name="lucide:image-down" :size="16" />
        </button>
        <button type="button" :class="[$style.toolBtn, $style.saveBtn]" aria-label="保存" title="保存 (⌘S)" @click="save">
          <MxIcon name="lucide:save" :size="16" />
          <span>保存</span>
        </button>
      </div>
    </div>

    <!-- 预设形状库浮层：分类分组网格，点击放置（遮罩点击关闭） -->
    <div v-if="shapesOpen" :class="$style.shapesMask" @click="shapesOpen = false" />
    <div v-if="shapesOpen" :class="$style.shapesPanel">
      <div v-for="g in presetGroups" :key="g.id" :class="$style.shapesCat">
        <p :class="$style.shapesCatTitle">{{ g.label }}</p>
        <div :class="$style.shapesGrid">
          <button
            v-for="p in g.items"
            :key="p.id"
            type="button"
            :class="$style.shapeBtn"
            :aria-label="p.label"
            :title="p.label"
            @click="placePreset(p)"
          >
            <svg :viewBox="p.view" :class="$style.shapeIcon" v-html="p.markup" />
          </button>
        </div>
      </div>
    </div>

    <!-- 画布区：滚轮缩放（鼠标锚点），缩放控件左下角 -->
    <div :class="$style.body">
      <p v-if="store.loading" :class="$style.hint">正在加载…</p>
      <p v-else-if="store.error" :class="$style.error">{{ store.error }}</p>
      <svg
        v-else
        ref="canvasEl"
        :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
        :class="[$style.canvas, { [$style.canvasHand]: tool === 'hand' || spaceDown }]"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="polyHover = null"
        @dblclick="onDblclick"
        @wheel.prevent="onWheel"
      >
        <template v-for="s in shapes" :key="s.id">
          <!-- 编组：g 承载 translate 与命中，子图形平铺渲染 -->
          <g
            v-if="s.kind === 'group'"
            v-bind="s.attrs"
            :data-shape-id="s.id"
            :class="[$style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          >
            <template v-for="c in s.children" :key="c.id">
              <rect v-if="c.kind === 'rect'" v-bind="c.attrs" />
              <ellipse v-else-if="c.kind === 'ellipse'" v-bind="c.attrs" />
              <line v-else-if="c.kind === 'line'" v-bind="c.attrs" />
              <text v-else-if="c.kind === 'text'" v-bind="c.attrs">{{ c.text }}</text>
              <polygon v-else-if="c.kind === 'polygon'" v-bind="c.attrs" />
              <path v-else v-bind="c.attrs" />
            </template>
          </g>
          <!-- 便签：g 承载位移，rect 纸面 + text 内容（选中态反馈走 rect 描边） -->
          <g
            v-else-if="s.kind === 'sticky'"
            v-bind="s.attrs.transform ? { transform: s.attrs.transform } : {}"
            :data-shape-id="s.id"
            :class="[$style.stickyRoot, $style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          >
            <rect v-bind="stickyRectAttrs(s)" :class="$style.stickyRect" />
            <text v-if="s.text" v-bind="stickyTextAttrs(s)">{{ s.text }}</text>
          </g>
          <rect
            v-else-if="s.kind === 'rect'"
            v-bind="s.attrs"
            :data-shape-id="s.id"
            :class="[$style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          />
          <ellipse
            v-else-if="s.kind === 'ellipse'"
            v-bind="s.attrs"
            :data-shape-id="s.id"
            :class="[$style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          />
          <line
            v-else-if="s.kind === 'line'"
            v-bind="s.attrs"
            :data-shape-id="s.id"
            :class="[$style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          />
          <text
            v-else-if="s.kind === 'text'"
            v-bind="s.attrs"
            :data-shape-id="s.id"
            :class="[$style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          >{{ s.text }}</text>
          <polygon
            v-else-if="s.kind === 'polygon'"
            v-bind="s.attrs"
            :data-shape-id="s.id"
            :class="[$style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          />
          <path
            v-else
            v-bind="s.attrs"
            :data-shape-id="s.id"
            :class="[$style.shape, { [$style.selected]: selectedIds.includes(s.id) }]"
          />
        </template>
        <!-- 绘制中草稿（按 kind 择一渲染） -->
        <rect v-if="draft && draft.kind === 'rect'" v-bind="draft.attrs" />
        <ellipse v-if="draft && draft.kind === 'ellipse'" v-bind="draft.attrs" />
        <line v-if="draft && draft.kind === 'line'" v-bind="draft.attrs" />
        <path v-if="draft && draft.kind === 'path'" v-bind="draft.attrs" />
        <!-- 多边形绘制预览：顶点 + 橡皮筋（虚线） -->
        <polygon
          v-if="tool === 'polygon' && polyPoints.length"
          :points="polyPreviewPts"
          :class="$style.polyDraft"
        />
        <!-- 框选预览 -->
        <rect
          v-if="marquee"
          :x="marquee.x"
          :y="marquee.y"
          :width="marquee.w"
          :height="marquee.h"
          :class="$style.marquee"
        />
        <!-- resize 拉伸柄：单选时八向方柄（line 端点圆柄，text 仅四角） -->
        <g v-if="handleRects.length">
          <rect
            v-for="h in handleRects"
            :key="h.handle"
            :data-handle="h.handle"
            :x="h.x"
            :y="h.y"
            :width="h.size"
            :height="h.size"
            :class="[$style.handle, $style[h.cur]]"
          />
        </g>
        <g v-if="lineHandles.length">
          <circle
            v-for="h in lineHandles"
            :key="h.handle"
            :data-handle="h.handle"
            :cx="h.cx"
            :cy="h.cy"
            :r="h.r"
            :class="[$style.lineHandle, $style.curMove]"
          />
        </g>
      </svg>
      <!-- 缩放控件：左下角悬浮（百分比 + 步进 + 适应内容） -->
      <ZoomControls :percent="zoomPercent" @zoom-in="vp.zoomStep(1)" @zoom-out="vp.zoomStep(-1)" @fit="fitContent" />
      <!-- 小地图：右下角悬浮（文档/内容/视口三层 + 点击拖动导航） -->
      <Minimap :doc-box="docBox" :content-box="contentBox" :view="view" @navigate="onMinimapNavigate" />
    </div>

    <!-- 选中属性工具栏：单选时悬挂在选区上方（改图形/填充/描边/线宽/字号） -->
    <div v-if="ctxBar" :class="$style.ctxBar" :style="{ left: ctxBar.x + 'px', top: ctxBar.y + 'px' }">
      <button
        v-if="ctxShape && ctxShape.kind !== 'text' && ctxShape.kind !== 'group'"
        type="button"
        :class="[$style.toolBtn, { [$style.toolActive]: ctxShapesOpen }]"
        aria-label="更改图形"
        title="更改图形"
        @click="ctxShapesOpen = !ctxShapesOpen"
      >
        <MxIcon name="lucide:shapes" :size="16" />
      </button>
      <span :class="$style.ctxDivider" />
      <label :class="$style.colorBtn" title="填充颜色">
        <span
          :class="$style.colorDot"
          :style="{ background: ctxShape && ctxShape.attrs.fill !== 'none' ? ctxShape.attrs.fill : 'transparent' }"
        />
        <input
          type="color"
          :class="$style.colorInput"
          :value="ctxShape && ctxShape.attrs.fill !== 'none' ? ctxShape.attrs.fill : fillPick"
          @input="liveFill"
          @change="resetColorSnap"
        />
      </label>
      <button
        type="button"
        :class="$style.toolBtn"
        aria-label="填充切换"
        title="填充：有 / 无"
        @click="toggleFillCtx"
      >
        <MxIcon name="lucide:paint-bucket" :size="16" />
      </button>
      <span :class="$style.ctxDivider" />
      <label :class="$style.colorBtn" title="描边颜色">
        <span :class="$style.colorDot" :style="{ background: ctxShape?.attrs.stroke || stroke }" />
        <input
          type="color"
          :class="$style.colorInput"
          :value="ctxShape?.attrs.stroke || stroke"
          @input="liveStroke"
          @change="resetColorSnap"
        />
      </label>
      <span :class="$style.ctxDivider" />
      <button
        v-for="w in WIDTHS"
        :key="w"
        type="button"
        :class="[$style.toolBtn, { [$style.toolActive]: ctxShape?.attrs['stroke-width'] === String(w) }]"
        :aria-label="`线宽 ${w}`"
        :title="`线宽 ${w}`"
        @click="patchAttrs({ 'stroke-width': String(w) })"
      >
        <span :class="$style.widthDot" :style="{ height: w + 2 + 'px', width: w + 2 + 'px' }" />
      </button>
      <template v-if="ctxShape?.kind === 'text'">
        <span :class="$style.ctxDivider" />
        <input
          type="number"
          min="8"
          :class="$style.ctxFont"
          :value="ctxShape.attrs['font-size'] || '24'"
          title="字号"
          aria-label="字号"
          @change="setFontSize"
        />
      </template>
      <!-- 便签四色切换（换色同步放置用色） -->
      <template v-if="ctxShape?.kind === 'sticky'">
        <span :class="$style.ctxDivider" />
        <button
          v-for="c in STICKY_COLORS"
          :key="c"
          type="button"
          :class="[$style.stickySwatch, { [$style.stickySwatchOn]: ctxShape.attrs.fill === c }]"
          :aria-label="`便签颜色 ${c}`"
          :title="`便签颜色 ${c}`"
          :style="{ background: c }"
          @click="patchAttrs({ fill: c }); stickyColor = c"
        />
      </template>
      <!-- 更改图形网格：单元素形状可替换（保留样式与中心位置） -->
      <div v-if="ctxShapesOpen" :class="$style.ctxShapes">
        <button
          v-for="p in CHANGEABLE_PRESETS"
          :key="p.id"
          type="button"
          :class="$style.shapeBtn"
          :aria-label="p.label"
          :title="p.label"
          @click="changeShape(p)"
        >
          <svg :viewBox="p.view" :class="$style.shapeIcon" v-html="p.markup" />
        </button>
      </div>
    </div>

    <!-- 文本编辑浮层（panel 相对定位） -->
    <input
      v-if="editBox"
      ref="editInput"
      v-model="editBox.value"
      :class="$style.editBox"
      :style="{ left: editBox.x + 'px', top: editBox.y + 'px' }"
      type="text"
      @keydown.enter.prevent="confirmEdit"
      @keydown.esc.prevent="cancelEdit"
      @blur="confirmEdit"
    />

    <!-- 状态行：文件名 + 图形数量 -->
    <div :class="$style.status">
      <MxIcon name="lucide:pen-tool" :size="16" />
      <span :class="$style.statusName" :title="store.currentFile">
        {{ fileName }}<template v-if="store.dirty">（未保存）</template>
      </span>
      <span :class="$style.statusMeta">图形 {{ shapes.length }} 个</span>
    </div>
  </div>
</template>

<style module>
.panel {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
}

/* 工具行：分组按钮（层级高于形状库浮层，避免窄面板换行时被遮挡） */
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  flex-wrap: wrap;
  flex-shrink: 0;
  position: relative;
  z-index: 3;
}

.group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  min-width: 28px;
  padding: 0 6px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  font: var(--mx-font-caption);
}

.toolBtn:hover {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.toolBtn:disabled {
  opacity: 0.35;
  cursor: default;
}

.toolBtn:disabled:hover {
  color: var(--mx-text-tertiary);
  background: transparent;
}

.toolBtn:focus-visible {
  outline: 2px solid var(--mx-border-strong);
  outline-offset: -1px;
}

.toolActive,
.toolActive:hover {
  background: var(--mx-active);
  color: var(--mx-text);
}

/* 原生取色器包裹（色点直接反映当前值；关闭态降透明度） */
.colorBtn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
}

.colorBtn:hover {
  background: var(--mx-hover);
}

.fillOff {
  opacity: 0.45;
}

.colorDot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid var(--mx-border-strong);
  pointer-events: none;
}

.colorInput {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.widthDot {
  display: inline-block;
  border-radius: 999px;
  background: currentColor;
}

.saveBtn {
  border: 1px solid var(--mx-border);
}

/* 画布区：固定白底（画板即纸面，不随主题变化），1px 边框保持边界清晰；
 * relative 承载缩放控件/小地图悬浮 */
.body {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: #ffffff;
  overflow: hidden;
  display: flex;
}

.canvas {
  flex: 1;
  min-height: 0;
  width: 100%;
  touch-action: none;
  cursor: crosshair;
  background: #ffffff;
}

/* 平移态光标（抓手工具或空格按住） */
.canvasHand {
  cursor: grab;
}

/* 预设形状库浮层：工具行下方左侧弹出，分类分组网格 */
.shapesMask {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.shapesPanel {
  position: absolute;
  top: 36px;
  left: var(--mx-space-3);
  z-index: 2;
  width: 340px;
  max-height: calc(100% - 60px);
  overflow-y: auto;
  padding: var(--mx-space-3);
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  /* 浮层叠在白色画布上：半透明底会被稀释，对齐 .mx-menu 先例用近不透明底（macOS
   * Electron 透明窗 backdrop-filter 失效，跳过 blur 直接 opaque） */
  background: var(--mx-menu-bg-opaque);
  box-shadow: var(--mx-shadow-prominent);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.shapesCatTitle {
  margin: 0 0 var(--mx-space-1);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.shapesGrid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
}

.shapeBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text);
  cursor: pointer;
}

.shapeBtn:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}

.shapeIcon {
  width: 30px;
  height: 24px;
}

/* 选中属性工具栏：悬挂在选区上方（水平中心对齐），点外不消失由 watch 语义保证 */
.ctxBar {
  position: absolute;
  z-index: 2;
  transform: translate(-50%, calc(-100% - 10px));
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: var(--mx-menu-bg-opaque);
  box-shadow: var(--mx-shadow-prominent);
}

.ctxDivider {
  width: 1px;
  height: 18px;
  background: var(--mx-border);
  margin: 0 4px;
  flex-shrink: 0;
}

/* 字号输入（text 单选时出现） */
.ctxFont {
  width: 52px;
  height: 26px;
  padding: 0 4px;
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text);
  font: var(--mx-font-caption);
  text-align: center;
  outline: none;
}

/* 更改图形网格：从工具栏上沿展开 */
.ctxShapes {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  width: 320px;
  max-height: 264px;
  overflow-y: auto;
  padding: var(--mx-space-3);
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: var(--mx-menu-bg-opaque);
  box-shadow: var(--mx-shadow-prominent);
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.shape {
  cursor: pointer;
  /* fill=none 的图形内部也要可点选/可擦除（SVG 默认 visiblePainted 只命中描边） */
  pointer-events: all;
}

/* 便签：rect 自带淡边（白底上可辨纸面），选中时 rect 走 accent 虚线描边 */
.stickyRect {
  stroke: rgba(0, 0, 0, 0.08);
  stroke-width: 1;
}

.stickyRoot.selected .stickyRect {
  stroke: var(--mx-accent);
  stroke-dasharray: 6 4;
}

/* 便签文字（左上对齐，pointer-events 穿透命中整体 g） */
.stickyRoot text {
  pointer-events: none;
}

/* ctxBar 便签色板（当前色加描边高亮） */
.stickySwatch {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.stickySwatch:hover {
  outline: 1px solid var(--mx-border-strong);
}

.stickySwatchOn {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

/* 选中态：虚线描边反馈（CSS presentation 属性覆盖 attrs） */
.selected {
  stroke-dasharray: 6 4;
}

.marquee {
  fill: none;
  stroke: var(--mx-border-strong);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}

/* resize 拉伸柄：白底 accent 描边（矢量描边不随缩放变粗） */
.handle {
  fill: #ffffff;
  stroke: var(--mx-accent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

/* line 端点圆柄 */
.lineHandle {
  fill: #ffffff;
  stroke: var(--mx-accent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

/* 柄方向光标（CSS Modules 类名映射，禁内联样式） */
.curNwse {
  cursor: nwse-resize;
}

.curNesw {
  cursor: nesw-resize;
}

.curNs {
  cursor: ns-resize;
}

.curEw {
  cursor: ew-resize;
}

.curMove {
  cursor: move;
}

/* 多边形绘制预览：虚线轮廓（填充留白，闭合后落当前样式） */
.polyDraft {
  fill: none;
  stroke: var(--mx-accent);
  stroke-width: 1;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}

/* 文本编辑浮层：panel 相对定位的绝对浮层 */
.editBox {
  position: absolute;
  min-width: 120px;
  padding: 2px 6px;
  border: 1px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  background: var(--mx-bg-surface);
  color: var(--mx-text);
  font-size: 14px;
  font-family: sans-serif;
  outline: none;
  z-index: 1;
}

.hint,
.error {
  margin: auto;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.error {
  color: var(--mx-warning);
}

/* 状态行：文件名 + 数量 */
.status {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-shrink: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.statusName {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mx-text-secondary);
}

.statusMeta {
  margin-left: auto;
  flex-shrink: 0;
}
</style>
