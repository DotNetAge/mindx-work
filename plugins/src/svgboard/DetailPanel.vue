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

const store = useSvgboardStore()

/**
 * 画布图形：attrs 直接序列化落盘（几何与样式属性并入）。
 * text 的内容在 text 字段；group 单层不嵌套（编组展平语义），children 必有。
 */
interface BoardShape {
  id: number
  kind: 'rect' | 'ellipse' | 'line' | 'path' | 'polygon' | 'text' | 'group'
  attrs: Record<string, string>
  text?: string
  children?: BoardShape[]
}

/** viewBox（meet 模式坐标换算基准；新建默认，导入取原文档） */
const vb = ref({ x: 0, y: 0, w: 1000, h: 700 })

const shapes = ref<BoardShape[]>([])
const selectedIds = ref<number[]>([])
let nextId = 1

// ── 工具态 ───────────────────────────────────────────────────────────────────
type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'pencil' | 'polygon' | 'text'
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

/** 文本编辑浮层（panel 相对定位的 client 坐标） */
const editBox = ref<{ id: number; value: string; x: number; y: number; isNew: boolean } | null>(null)
const editInput = ref<HTMLInputElement | null>(null)

// ── 撤销栈（shapes 快照）────────────────────────────────────────────────────
const history = ref<string[]>([])
const HISTORY_CAP = 50

function snapshot(): void {
  history.value.push(JSON.stringify(shapes.value))
  if (history.value.length > HISTORY_CAP) history.value.shift()
}

function undo(): void {
  const prev = history.value.pop()
  if (!prev) return
  shapes.value = JSON.parse(prev) as BoardShape[]
  selectedIds.value = []
  editBox.value = null
  store.dirty = true
}

// ── 坐标换算（viewBox meet 居中补偿）────────────────────────────────────────
const canvasEl = ref<SVGSVGElement | null>(null)
const panelEl = ref<HTMLDivElement | null>(null)

function canvasScale(): { scale: number; ox: number; oy: number } {
  const box = canvasEl.value!.getBoundingClientRect()
  const scale = Math.min(box.width / vb.value.w, box.height / vb.value.h)
  return { scale, ox: (box.width - vb.value.w * scale) / 2, oy: (box.height - vb.value.h * scale) / 2 }
}

function svgPoint(e: PointerEvent): { x: number; y: number } {
  const box = canvasEl.value!.getBoundingClientRect()
  const { scale, ox, oy } = canvasScale()
  return {
    x: (e.clientX - box.left - ox) / scale + vb.value.x,
    y: (e.clientY - box.top - oy) / scale + vb.value.y,
  }
}

/** 图形当前视觉 bbox（含 transform，client 反换算回 svg 坐标） */
function visualBBox(id: number): { left: number; top: number; right: number; bottom: number } | null {
  const el = canvasEl.value?.querySelector(`[data-shape-id="${id}"]`)
  if (!el) return null
  const box = canvasEl.value!.getBoundingClientRect()
  const { scale, ox, oy } = canvasScale()
  const r = el.getBoundingClientRect()
  return {
    left: (r.left - box.left - ox) / scale + vb.value.x,
    top: (r.top - box.top - oy) / scale + vb.value.y,
    right: (r.right - box.left - ox) / scale + vb.value.x,
    bottom: (r.bottom - box.top - oy) / scale + vb.value.y,
  }
}

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

// ── 指针交互 ─────────────────────────────────────────────────────────────────

function onPointerDown(e: PointerEvent): void {
  if (editBox.value) confirmEdit()
  // 指针捕获：拖拽移出画布仍持续收 move/up
  canvasEl.value?.setPointerCapture(e.pointerId)
  const p = svgPoint(e)
  if (tool.value === 'select') {
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
      const { scale } = canvasScale()
      if (Math.hypot(p.x - first.x, p.y - first.y) < 10 / scale) {
        commitPolygon()
        return
      }
    }
    polyPoints.value = [...polyPoints.value, p]
    return
  }
  if (tool.value === 'text') {
    placeText(p, { x: e.clientX, y: e.clientY })
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

/** select 拖动：translate 合并（保留此前位移，二次拖动不跳回） */
function mergeTranslate(shape: BoardShape, dx: number, dy: number): void {
  if (!dx && !dy) return
  const m = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(shape.attrs.transform || '')
  const bx = m ? Number(m[1]) : 0
  const by = m ? Number(m[2]) : 0
  shape.attrs.transform = `translate(${round(bx + dx)} ${round(by + dy)})`
}

function onPointerMove(e: PointerEvent): void {
  if (tool.value === 'select') {
    if (lastDrag && selectedIds.value.length) {
      // 帧增量：整体位移所有选中
      const { scale } = canvasScale()
      const dx = (e.clientX - lastDrag.x) / scale
      const dy = (e.clientY - lastDrag.y) / scale
      lastDrag = { x: e.clientX, y: e.clientY }
      if (dx || dy) {
        for (const id of selectedIds.value) {
          const shape = shapes.value.find((s) => s.id === id)
          if (shape) mergeTranslate(shape, dx, dy)
        }
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
  if (!draft.value) return
  const a = draft.value.attrs
  // 零尺寸误触丢弃：同步回滚撤销栈快照
  let trivial: boolean
  if (draft.value.kind === 'rect') trivial = Number(a.width) < 2 && Number(a.height) < 2
  else if (draft.value.kind === 'ellipse') trivial = Number(a.rx) < 1 && Number(a.ry) < 1
  else if (draft.value.kind === 'line') trivial = Math.abs(Number(a.x2) - Number(a.x1)) < 2 && Math.abs(Number(a.y2) - Number(a.y1)) < 2
  else trivial = pencilPoints.length < 2
  if (trivial) {
    history.value.pop()
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
  const hit = (e.target as Element).closest('[data-shape-id]')
  if (!hit) return
  const shape = shapes.value.find((s) => s.id === Number((hit as Element).getAttribute('data-shape-id')))
  if (shape?.kind === 'text') startEdit(shape, { x: e.clientX, y: e.clientY }, false)
}

// ── 对齐 / 编组 / 删除 ───────────────────────────────────────────────────────

type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 对齐：单选对画布、多选互对齐（基准 = 选区联合 bbox） */
function align(mode: AlignMode): void {
  const ids = selectedIds.value
  if (!ids.length) return
  const boxes = ids.map((id) => ({ id, b: visualBBox(id) }))
  if (boxes.some((x) => !x.b)) return
  const canvasBox = { left: vb.value.x, top: vb.value.y, right: vb.value.x + vb.value.w, bottom: vb.value.y + vb.value.h }
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
      const gt = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(g.attrs.transform || '')
      if (gt) mergeTranslate(c, Number(gt[1]), Number(gt[2]))
      flat.push(c)
    }
  }
  shapes.value = [...rest, ...flat]
  selectedIds.value = flat.map((s) => s.id)
  store.dirty = true
}

function deleteSelected(): void {
  if (!selectedIds.value.length) return
  snapshot()
  shapes.value = shapes.value.filter((s) => !selectedIds.value.includes(s.id))
  selectedIds.value = []
  store.dirty = true
}

function onKeydown(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.value.length) {
    e.preventDefault()
    deleteSelected()
  } else if (e.key === 'Enter' && polyPoints.value.length) {
    // 多边形绘制中：回车闭合
    e.preventDefault()
    commitPolygon()
  } else if (e.key === 'Escape' && polyPoints.value.length) {
    // 多边形绘制中：Esc 丢弃
    polyPoints.value = []
    polyHover.value = null
  } else if (e.key === 'Escape' && shapesOpen.value) {
    // 形状库浮层：Esc 关闭
    shapesOpen.value = false
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
    e.preventDefault()
    if (e.shiftKey) ungroupSelected()
    else groupSelected()
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void save()
  }
}

// 画布序列化器登记：「添加到对话」先落盘再引用时取当前画布文本（卸载注销）
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  store.serializer = () => serialize()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
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
  if (s.kind === 'text') return `<text ${attrString(s.attrs)}>${esc(s.text || '')}</text>`
  if (s.kind === 'group') {
    const body = (s.children || []).map(serializeShape).join('\n    ')
    return `<g ${attrString(s.attrs)}>\n    ${body}\n  </g>`
  }
  return `<${s.kind} ${attrString(s.attrs)}/>`
}

function serialize(): string {
  const body = shapes.value.map(serializeShape).join('\n  ')
  const v = vb.value
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

/** SVG 文本导入：递归解析（g → 单层 group；text 取 textContent） */
function importNode(el: Element): BoardShape | null {
  const kind = el.tagName
  const base: BoardShape = { id: nextId++, kind: 'path', attrs: {}, text: undefined, children: undefined }
  if (kind === 'g') {
    const children = Array.from(el.children)
      .map(importNode)
      .filter((x): x is BoardShape => x !== null)
    if (!children.length) return null
    const t = translateOnly(el.getAttribute('transform'))
    return { ...base, kind: 'group', attrs: t ? { transform: t } : {}, children }
  }
  const attrs: Record<string, string> = {}
  for (const name of el.getAttributeNames()) attrs[name] = el.getAttribute(name) || ''
  // 自绘白底 rect（serialize 注入）不属于图形内容
  if (kind === 'rect' && attrs.id === 'svgboard-bg') return null
  if (kind === 'text') {
    return { ...base, kind: 'text', attrs: { ...attrs, 'font-family': attrs['font-family'] || 'sans-serif' }, text: (el.textContent || '').trim() || ' ' }
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
    return { ...base, kind: 'path', attrs }
  }
  if (kind === 'polygon') {
    // polygon 保留基元（≥3 个顶点；与多边形工具的原生形态一致）
    const n = (attrs.points || '').trim().split(/[\s,]+/).filter(Boolean).length
    if (n < 6 || n % 2 !== 0) return null
    return { ...base, kind: 'polygon', attrs }
  }
  if (kind === 'rect' || kind === 'ellipse' || kind === 'line' || kind === 'path') {
    return { ...base, kind, attrs }
  }
  return null
}

function importSvg(text: string): boolean {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return false
  const root = doc.documentElement
  const vbAttr = root.getAttribute('viewBox')
  if (vbAttr) {
    const n = vbAttr.trim().split(/[\s,]+/).map(Number)
    if (n.length === 4 && n.every((x) => Number.isFinite(x))) {
      vb.value = { x: n[0]!, y: n[1]!, w: n[2]!, h: n[3]! }
    }
  } else {
    const w = Number(root.getAttribute('width')) || 1000
    const h = Number(root.getAttribute('height')) || 700
    vb.value = { x: 0, y: 0, w, h }
  }
  const collected: BoardShape[] = []
  for (const child of Array.from(root.children)) {
    const shape = importNode(child)
    if (shape) collected.push(shape)
  }
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
    history.value = []
    selectedIds.value = []
    editBox.value = null
    if (!importSvg(text)) ElMessage.warning('SVG 解析失败，已打开空白画板')
  }
)

async function save(): Promise<void> {
  const ok = await store.save(serialize())
  if (ok) ElMessage.success('已保存')
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
  { id: 'rect', icon: 'lucide:square', tip: '矩形' },
  { id: 'ellipse', icon: 'lucide:circle', tip: '椭圆' },
  { id: 'line', icon: 'lucide:minus', tip: '直线' },
  { id: 'polygon', icon: 'lucide:hexagon', tip: '多边形（依次点击落点，双击/回车/点回起点闭合）' },
  { id: 'pencil', icon: 'lucide:pencil', tip: '自由绘制' },
  { id: 'text', icon: 'lucide:type', tip: '文本（点击放置，双击已有文本编辑）' },
]

const ALIGNS: { id: AlignMode; icon: string; tip: string }[] = [
  { id: 'left', icon: 'lucide:align-start-vertical', tip: '左对齐' },
  { id: 'hcenter', icon: 'lucide:align-center-vertical', tip: '水平居中' },
  { id: 'right', icon: 'lucide:align-end-vertical', tip: '右对齐' },
  { id: 'top', icon: 'lucide:align-start-horizontal', tip: '顶对齐' },
  { id: 'vcenter', icon: 'lucide:align-center-horizontal', tip: '垂直居中' },
  { id: 'bottom', icon: 'lucide:align-end-horizontal', tip: '底对齐' },
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
  const tx = round(vb.value.x + (vb.value.w - p.w) / 2 + step)
  const ty = round(vb.value.y + (vb.value.h - p.h) / 2 + step)
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

/** 选区视觉 bbox 中心 → panel 相对坐标（工具栏悬挂点） */
function updateCtxBar(): void {
  const s = selectedShape()
  if (!s || editBox.value) {
    ctxBar.value = null
    ctxShapesOpen.value = false
    return
  }
  const b = visualBBox(s.id)
  if (!b || !panelEl.value || !canvasEl.value) {
    ctxBar.value = null
    return
  }
  const panelBox = panelEl.value.getBoundingClientRect()
  const box = canvasEl.value.getBoundingClientRect()
  const { scale, ox, oy } = canvasScale()
  const cx = ((b.left + b.right) / 2 - vb.value.x) * scale + ox
  ctxBar.value = {
    x: cx + box.left - panelBox.left,
    y: (b.top - vb.value.y) * scale + oy + box.top - panelBox.top,
  }
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
  if (!s || s.kind === 'group' || s.kind === 'text') return
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
          aria-label="撤销"
          title="撤销 (⌘Z)"
          :disabled="history.length === 0"
          @click="undo"
        >
          <MxIcon name="lucide:undo-2" :size="16" />
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

    <!-- 画布区 -->
    <div :class="$style.body">
      <p v-if="store.loading" :class="$style.hint">正在加载…</p>
      <p v-else-if="store.error" :class="$style.error">{{ store.error }}</p>
      <svg
        v-else
        ref="canvasEl"
        :viewBox="`${vb.x} ${vb.y} ${vb.w} ${vb.h}`"
        :class="$style.canvas"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="polyHover = null"
        @dblclick="onDblclick"
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
      </svg>
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

/* 画布区：固定白底（画板即纸面，不随主题变化），1px 边框保持边界清晰 */
.body {
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
}

/* 多边形绘制预览：虚线轮廓（填充留白，闭合后落当前样式） */
.polyDraft {
  fill: none;
  stroke: var(--mx-accent);
  stroke-width: 1;
  stroke-dasharray: 4 3;
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
