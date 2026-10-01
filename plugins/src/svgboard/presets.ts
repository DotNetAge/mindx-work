/**
 * svgboard 预设形状库：分类清单与几何生成（对齐 draw.io 形状面板形态）。
 * 全部形状以 (0,0) 为原点、按预设默认尺寸生成几何；样式（描边/填充/线宽）
 * 由面板放置时注入，个别元素（如实心箭头）在 build 内覆盖 fill。
 * 预览线稿复用同一 build（注入 currentColor 预览样式），标记串由内置常量
 * 生成、无任何用户输入，v-html 安全。
 */

export interface PresetElement {
  kind: 'rect' | 'ellipse' | 'line' | 'path' | 'polygon'
  attrs: Record<string, string>
}

export type PresetCategoryId =
  | 'basic'
  | 'line'
  | 'lane'
  | 'flow'
  | 'class'
  | 'sequence'
  | 'dataflow'
  | 'er'
  | 'component'

export interface ShapePreset {
  id: string
  label: string
  category: PresetCategoryId
  /** 落画布默认尺寸（build 生成 0..w / 0..h 几何；线类可为一维 0） */
  w: number
  h: number
  /** 预览 viewBox（含描边留白） */
  view: string
  /** 几何生成：style 为当前描边/填充样式，返回单元素或 group 元素组 */
  build(style: Record<string, string>): PresetElement | PresetElement[]
}

export interface PresetCategory {
  id: PresetCategoryId
  label: string
}

// ── 几何辅助 ─────────────────────────────────────────────────────────────────

const r1 = (n: number): number => Math.round(n * 10) / 10

type Pt = [number, number]

const pts = (list: Pt[]): string => list.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' ')

/** 正 n 边形顶点串（rot 起始角，度；-90 = 尖朝上） */
function regular(n: number, w: number, h: number, rot = -90): string {
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) / 2
  const list: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180
    list.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts(list)
}

/** n 角星顶点串（内外半径交替） */
function star(n: number, w: number, h: number, inner = 0.4, rot = -90): string {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) / 2
  const list: Pt[] = []
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? R : R * inner
    const a = ((rot + (360 / (n * 2)) * i) * Math.PI) / 180
    list.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return pts(list)
}

/** 云朵轮廓（贝塞尔，底部直线闭合；thought 气泡复用） */
function cloudD(w: number, h: number): string {
  return [
    `M ${r1(w * 0.2)} ${r1(h)}`,
    `C ${r1(w * 0.02)} ${r1(h)} 0 ${r1(h * 0.74)} ${r1(w * 0.08)} ${r1(h * 0.56)}`,
    `C 0 ${r1(h * 0.36)} ${r1(w * 0.12)} ${r1(h * 0.18)} ${r1(w * 0.3)} ${r1(h * 0.24)}`,
    `C ${r1(w * 0.36)} ${r1(h * 0.04)} ${r1(w * 0.62)} 0 ${r1(w * 0.72)} ${r1(h * 0.18)}`,
    `C ${r1(w * 0.9)} ${r1(h * 0.14)} ${r1(w)} ${r1(h * 0.34)} ${r1(w * 0.94)} ${r1(h * 0.5)}`,
    `C ${r1(w)} ${r1(h * 0.7)} ${r1(w * 0.86)} ${r1(h)} ${r1(w * 0.7)} ${r1(h)}`,
    'Z',
  ].join(' ')
}

/** 圆柱元素组：主体 path（顶弦闭合）+ 顶部椭圆盖板 */
function cylinderEls(w: number, h: number, ry: number): PresetElement[] {
  return [
    {
      kind: 'path',
      attrs: {
        d: `M 0 ${r1(ry)} L 0 ${r1(h - ry)} A ${r1(w / 2)} ${r1(ry)} 0 0 0 ${r1(w)} ${r1(h - ry)} L ${r1(w)} ${r1(ry)} Z`,
      },
    },
    { kind: 'ellipse', attrs: { cx: String(r1(w / 2)), cy: String(r1(ry)), rx: String(r1(w / 2)), ry: String(r1(ry)) } },
  ]
}

// ── 分类 ─────────────────────────────────────────────────────────────────────

export const PRESET_CATEGORIES: PresetCategory[] = [
  { id: 'basic', label: '基础形状' },
  { id: 'line', label: '直线' },
  { id: 'lane', label: '泳道' },
  { id: 'flow', label: '流程图' },
  { id: 'class', label: '类图' },
  { id: 'sequence', label: '时序图' },
  { id: 'dataflow', label: '数据流图' },
  { id: 'er', label: '实体关系图' },
  { id: 'component', label: '组件图' },
]

// ── 预设清单 ─────────────────────────────────────────────────────────────────

export const SHAPE_PRESETS: ShapePreset[] = [
  // 基础形状 ──────────────────────────────────────────────────────────────────
  {
    id: 'rect', label: '矩形', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '160', height: '90' } }),
  },
  {
    id: 'round-rect', label: '圆角矩形', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '160', height: '90', rx: '12' } }),
  },
  {
    id: 'ellipse', label: '椭圆', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'ellipse', attrs: { cx: '80', cy: '45', rx: '80', ry: '45' } }),
  },
  {
    id: 'circle', label: '圆', category: 'basic', w: 100, h: 100, view: '-6 -6 112 112',
    build: () => ({ kind: 'ellipse', attrs: { cx: '50', cy: '50', rx: '50', ry: '50' } }),
  },
  {
    id: 'triangle', label: '三角形', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[80, 0], [160, 90], [0, 90]]) } }),
  },
  {
    id: 'right-triangle', label: '直角三角形', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[0, 0], [160, 90], [0, 90]]) } }),
  },
  {
    id: 'diamond', label: '菱形', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[80, 0], [160, 45], [80, 90], [0, 45]]) } }),
  },
  {
    id: 'parallelogram', label: '平行四边形', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[32, 0], [160, 0], [128, 90], [0, 90]]) } }),
  },
  {
    id: 'trapezoid', label: '梯形', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[28, 0], [132, 0], [160, 90], [0, 90]]) } }),
  },
  {
    id: 'pentagon', label: '五边形', category: 'basic', w: 100, h: 100, view: '-6 -6 112 112',
    build: () => ({ kind: 'polygon', attrs: { points: regular(5, 100, 100) } }),
  },
  {
    id: 'hexagon', label: '六边形', category: 'basic', w: 100, h: 100, view: '-6 -6 112 112',
    build: () => ({ kind: 'polygon', attrs: { points: regular(6, 100, 100) } }),
  },
  {
    id: 'octagon', label: '八边形', category: 'basic', w: 110, h: 110, view: '-6 -6 122 122',
    build: () => ({ kind: 'polygon', attrs: { points: regular(8, 110, 110) } }),
  },
  {
    id: 'star', label: '五角星', category: 'basic', w: 110, h: 110, view: '-6 -6 122 122',
    build: () => ({ kind: 'polygon', attrs: { points: star(5, 110, 110) } }),
  },
  {
    id: 'star6', label: '六角星', category: 'basic', w: 110, h: 110, view: '-6 -6 122 122',
    build: () => ({ kind: 'polygon', attrs: { points: star(6, 110, 110, 0.55) } }),
  },
  {
    id: 'cloud', label: '云', category: 'basic', w: 160, h: 90, view: '-6 -6 172 102',
    build: () => ({ kind: 'path', attrs: { d: cloudD(160, 90) } }),
  },
  {
    id: 'cylinder', label: '圆柱', category: 'basic', w: 120, h: 110, view: '-6 -6 132 122',
    build: () => cylinderEls(120, 110, 16),
  },
  {
    id: 'cube', label: '立方体', category: 'basic', w: 140, h: 110, view: '-6 -6 152 122',
    build: () => {
      const o = r1(110 * 0.22)
      return {
        kind: 'path',
        attrs: {
          d: `M 0 ${o} L ${o} 0 L 140 0 L 140 ${r1(110 - Number(o))} L ${r1(140 - Number(o))} 110 L 0 110 Z M 0 ${o} L ${r1(140 - Number(o))} ${o} L 140 0 M ${r1(140 - Number(o))} ${o} L ${r1(140 - Number(o))} 110`,
        },
      }
    },
  },
  {
    id: 'bubble', label: '对话气泡', category: 'basic', w: 150, h: 100, view: '-6 -6 162 112',
    build: () => {
      const bh = r1(100 * 0.72)
      const tx = r1(150 * 0.18)
      const tw = r1(150 * 0.14)
      return {
        kind: 'path',
        attrs: {
          d: `M 10 0 L 140 0 Q 150 0 150 10 L 150 ${bh} L ${r1(tx + tw)} ${bh} L ${tx} 100 L ${r1(tx + tw * 0.3)} ${bh} L 0 ${bh} L 0 10 Q 0 0 10 0 Z`,
        },
      }
    },
  },
  {
    id: 'round-bubble', label: '圆气泡', category: 'basic', w: 150, h: 110, view: '-6 -6 162 122',
    build: (): PresetElement[] => {
      const bh = r1(110 * 0.76)
      const tx = r1(150 * 0.34)
      const tw = r1(150 * 0.14)
      return [
        { kind: 'ellipse', attrs: { cx: '75', cy: String(r1(bh / 2)), rx: '75', ry: String(r1(bh / 2)) } },
        { kind: 'polygon', attrs: { points: pts([[tx, r1(bh * 0.72)], [r1(tx + tw), r1(bh * 0.72)], [r1(tx + tw * 0.15), 110]]) } },
      ]
    },
  },
  {
    id: 'thought', label: '思考气泡', category: 'basic', w: 140, h: 110, view: '-6 -6 152 122',
    build: (): PresetElement[] => [
      { kind: 'path', attrs: { d: cloudD(140, 80) } },
      { kind: 'ellipse', attrs: { cx: String(r1(140 * 0.24)), cy: '97', rx: '9', ry: '7' } },
      { kind: 'ellipse', attrs: { cx: String(r1(140 * 0.4)), cy: '108', rx: '5', ry: '4' } },
    ],
  },
  {
    id: 'cross', label: '十字', category: 'basic', w: 110, h: 110, view: '-6 -6 122 122',
    build: () => {
      const t = r1(110 * 0.34)
      const a = r1((110 - Number(t)) / 2)
      const b = r1((110 + Number(t)) / 2)
      return {
        kind: 'polygon',
        attrs: { points: pts([[a, 0], [b, 0], [b, a], [110, a], [110, b], [b, b], [b, 110], [a, 110], [a, b], [0, b], [0, a], [a, a]]) },
      }
    },
  },
  {
    id: 'arc', label: '弧形', category: 'basic', w: 110, h: 110, view: '-6 -6 122 122',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 A 110 110 0 0 1 110 110 L 0 110 Z' } }),
  },
  {
    id: 'pie', label: '饼形', category: 'basic', w: 110, h: 110, view: '-6 -6 122 122',
    build: () => ({ kind: 'path', attrs: { d: 'M 55 55 L 55 0 A 55 55 0 1 1 110 55 Z' } }),
  },
  {
    id: 'heart', label: '心形', category: 'basic', w: 110, h: 100, view: '-6 -6 122 112',
    build: () => ({
      kind: 'path',
      attrs: {
        d: 'M 55 32 C 51 10 18 0 9 16 C 0 32 7 60 55 100 C 103 60 110 32 101 16 C 92 0 59 10 55 32 Z',
      },
    }),
  },
  {
    id: 'arrow-right', label: '右箭头', category: 'basic', w: 160, h: 80, view: '-6 -6 172 92',
    build: () => {
      const hl = r1(160 * 0.32)
      const t = r1((80 - 80 * 0.5) / 2)
      return {
        kind: 'polygon',
        attrs: { points: pts([[0, t], [r1(160 - hl), t], [r1(160 - hl), 0], [160, 40], [r1(160 - hl), 80], [r1(160 - hl), r1(80 - Number(t))], [0, r1(80 - Number(t))]]) },
      }
    },
  },
  {
    id: 'arrow-left', label: '左箭头', category: 'basic', w: 160, h: 80, view: '-6 -6 172 92',
    build: () => {
      const hl = r1(160 * 0.32)
      const t = r1((80 - 80 * 0.5) / 2)
      return {
        kind: 'polygon',
        attrs: { points: pts([[hl, t], [160, t], [160, r1(80 - Number(t))], [hl, r1(80 - Number(t))], [hl, 80], [0, 40], [hl, 0]]) },
      }
    },
  },
  {
    id: 'arrow-up', label: '上箭头', category: 'basic', w: 80, h: 120, view: '-6 -6 92 132',
    build: () => {
      const hh = r1(120 * 0.35)
      const rw = r1((80 - 80 * 0.5) / 2)
      return {
        kind: 'polygon',
        attrs: { points: pts([[rw, hh], [0, hh], [40, 0], [80, hh], [r1(80 - Number(rw)), hh], [r1(80 - Number(rw)), 120], [rw, 120]]) },
      }
    },
  },
  {
    id: 'arrow-both', label: '双向箭头', category: 'basic', w: 180, h: 70, view: '-6 -6 192 82',
    build: () => {
      const hl = r1(180 * 0.2)
      const t = r1((70 - 70 * 0.5) / 2)
      return {
        kind: 'polygon',
        attrs: { points: pts([[hl, 0], [r1(180 - hl), 0], [r1(180 - hl), t], [180, 35], [r1(180 - hl), r1(70 - Number(t))], [r1(180 - hl), 70], [hl, 70], [hl, r1(70 - Number(t))], [0, 35], [hl, t]]) },
      }
    },
  },
  {
    id: 'chevron', label: 'V 形箭头', category: 'basic', w: 130, h: 80, view: '-6 -6 142 92',
    build: () => ({
      kind: 'polygon',
      attrs: { points: pts([[0, 0], [90, 0], [130, 40], [90, 80], [0, 80], [40, 40]]) },
    }),
  },
  {
    id: 'brace', label: '大括号', category: 'basic', w: 48, h: 120, view: '-6 -6 60 132',
    build: () => ({
      kind: 'path',
      attrs: { d: 'M 41 2 C 14 2 17 36 6 60 C 17 84 14 118 41 118' },
    }),
  },
  {
    id: 'bracket', label: '方括号', category: 'basic', w: 36, h: 120, view: '-6 -6 48 132',
    build: () => ({ kind: 'path', attrs: { d: 'M 29 2 L 7 2 L 7 118 L 29 118' } }),
  },

  // 直线 ──────────────────────────────────────────────────────────────────────
  {
    id: 'line', label: '直线', category: 'line', w: 160, h: 0, view: '-14 -16 188 32',
    build: () => ({ kind: 'line', attrs: { x1: '0', y1: '0', x2: '160', y2: '0' } }),
  },
  {
    id: 'line-dash', label: '虚线', category: 'line', w: 160, h: 0, view: '-14 -16 188 32',
    build: () => ({ kind: 'line', attrs: { x1: '0', y1: '0', x2: '160', y2: '0', 'stroke-dasharray': '8 6' } }),
  },
  {
    id: 'line-arrow', label: '箭头线', category: 'line', w: 160, h: 0, view: '-14 -18 188 36',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 L 160 0 M 146 -7 L 160 0 L 146 7' } }),
  },
  {
    id: 'line-arrow2', label: '双向箭头线', category: 'line', w: 160, h: 0, view: '-14 -18 188 36',
    build: () => ({ kind: 'path', attrs: { d: 'M 14 -7 L 0 0 L 14 7 M 0 0 L 160 0 M 146 -7 L 160 0 L 146 7' } }),
  },
  {
    id: 'line-dash-arrow', label: '虚线箭头', category: 'line', w: 160, h: 0, view: '-14 -18 188 36',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 L 160 0 M 146 -7 L 160 0 L 146 7', 'stroke-dasharray': '7 5' } }),
  },

  // 泳道 ──────────────────────────────────────────────────────────────────────
  {
    id: 'lane-2', label: '泳道（2 行）', category: 'lane', w: 240, h: 120, view: '-6 -6 252 132',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '240', height: '120' } },
      { kind: 'line', attrs: { x1: '0', y1: '60', x2: '240', y2: '60' } },
    ],
  },
  {
    id: 'lane-3', label: '泳道（3 行）', category: 'lane', w: 240, h: 150, view: '-6 -6 252 162',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '240', height: '150' } },
      { kind: 'line', attrs: { x1: '0', y1: '50', x2: '240', y2: '50' } },
      { kind: 'line', attrs: { x1: '0', y1: '100', x2: '240', y2: '100' } },
    ],
  },
  {
    id: 'lane-col', label: '泳道（2 列）', category: 'lane', w: 240, h: 120, view: '-6 -6 252 132',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '240', height: '120' } },
      { kind: 'line', attrs: { x1: '120', y1: '0', x2: '120', y2: '120' } },
    ],
  },

  // 流程图 ────────────────────────────────────────────────────────────────────
  {
    id: 'flow-process', label: '流程', category: 'flow', w: 150, h: 80, view: '-6 -6 162 92',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '150', height: '80' } }),
  },
  {
    id: 'flow-alt', label: '备选流程', category: 'flow', w: 150, h: 80, view: '-6 -6 162 92',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '150', height: '80', rx: '12' } }),
  },
  {
    id: 'flow-decision', label: '判定', category: 'flow', w: 140, h: 90, view: '-6 -6 152 102',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[70, 0], [140, 45], [70, 90], [0, 45]]) } }),
  },
  {
    id: 'flow-document', label: '文档', category: 'flow', w: 150, h: 90, view: '-6 -6 162 102',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 L 150 0 L 150 78 Q 75 104 0 78 Z' } }),
  },
  {
    id: 'flow-docs', label: '多文档', category: 'flow', w: 162, h: 102, view: '-6 -6 174 114',
    build: (): PresetElement[] => [
      { kind: 'path', attrs: { d: 'M 12 12 L 162 12 L 162 90 Q 87 116 12 90 Z' } },
      { kind: 'path', attrs: { d: 'M 0 0 L 150 0 L 150 78 Q 75 104 0 78 Z' } },
    ],
  },
  {
    id: 'flow-data', label: '数据', category: 'flow', w: 150, h: 80, view: '-6 -6 162 92',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[30, 0], [150, 0], [120, 80], [0, 80]]) } }),
  },
  {
    id: 'flow-db', label: '数据库', category: 'flow', w: 110, h: 120, view: '-6 -6 122 132',
    build: () => cylinderEls(110, 120, 18),
  },
  {
    id: 'flow-predefined', label: '预定义处理', category: 'flow', w: 150, h: 80, view: '-6 -6 162 92',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '150', height: '80' } },
      { kind: 'line', attrs: { x1: '12', y1: '0', x2: '12', y2: '80' } },
      { kind: 'line', attrs: { x1: '138', y1: '0', x2: '138', y2: '80' } },
    ],
  },
  {
    id: 'flow-prep', label: '准备', category: 'flow', w: 150, h: 70, view: '-6 -6 162 82',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[18, 0], [132, 0], [150, 35], [132, 70], [18, 70], [0, 35]]) } }),
  },
  {
    id: 'flow-manual-input', label: '手动输入', category: 'flow', w: 150, h: 80, view: '-6 -6 162 92',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[0, 24], [150, 0], [150, 80], [0, 80]]) } }),
  },
  {
    id: 'flow-manual-op', label: '手动操作', category: 'flow', w: 150, h: 80, view: '-6 -6 162 92',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[0, 0], [150, 0], [120, 80], [30, 80]]) } }),
  },
  {
    id: 'flow-delay', label: '延迟', category: 'flow', w: 130, h: 70, view: '-6 -6 142 82',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 L 72 0 A 58 35 0 0 1 72 70 L 0 70 Z' } }),
  },
  {
    id: 'flow-display', label: '显示', category: 'flow', w: 150, h: 80, view: '-6 -6 162 92',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[27, 0], [123, 0], [150, 80], [0, 80]]) } }),
  },
  {
    id: 'flow-terminator', label: '终止', category: 'flow', w: 150, h: 64, view: '-6 -6 162 76',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '150', height: '64', rx: '32' } }),
  },
  {
    id: 'flow-connector', label: '连接点', category: 'flow', w: 70, h: 70, view: '-6 -6 82 82',
    build: () => ({ kind: 'ellipse', attrs: { cx: '35', cy: '35', rx: '35', ry: '35' } }),
  },

  // 类图 ──────────────────────────────────────────────────────────────────────
  {
    id: 'class-box', label: '类', category: 'class', w: 170, h: 120, view: '-6 -6 182 132',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '170', height: '120' } },
      { kind: 'line', attrs: { x1: '0', y1: '40', x2: '170', y2: '40' } },
      { kind: 'line', attrs: { x1: '0', y1: '80', x2: '170', y2: '80' } },
    ],
  },
  {
    id: 'class-interface', label: '接口', category: 'class', w: 170, h: 90, view: '-6 -6 182 102',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '170', height: '90' } },
      { kind: 'line', attrs: { x1: '0', y1: '45', x2: '170', y2: '45' } },
    ],
  },
  {
    id: 'class-enum', label: '枚举', category: 'class', w: 170, h: 100, view: '-6 -6 182 112',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '170', height: '100' } },
      { kind: 'line', attrs: { x1: '0', y1: '30', x2: '170', y2: '30' } },
    ],
  },
  {
    id: 'class-note', label: '注释', category: 'class', w: 130, h: 100, view: '-6 -6 142 112',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 L 108 0 L 130 22 L 130 100 L 0 100 Z M 108 0 L 108 22 L 130 22' } }),
  },
  {
    id: 'class-lollipop', label: '提供接口', category: 'class', w: 120, h: 44, view: '-6 -6 132 56',
    build: (): PresetElement[] => [
      { kind: 'line', attrs: { x1: '0', y1: '22', x2: '96', y2: '22' } },
      { kind: 'ellipse', attrs: { cx: '108', cy: '22', rx: '12', ry: '12' } },
    ],
  },
  {
    id: 'class-socket', label: '必需接口', category: 'class', w: 120, h: 44, view: '-6 -6 132 56',
    build: (): PresetElement[] => [
      { kind: 'line', attrs: { x1: '0', y1: '22', x2: '106', y2: '22' } },
      { kind: 'path', attrs: { d: 'M 106 11 A 11 11 0 0 1 106 33' } },
    ],
  },
  {
    id: 'class-empty', label: '空类框', category: 'class', w: 170, h: 80, view: '-6 -6 182 92',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '170', height: '80' } }),
  },

  // 时序图 ────────────────────────────────────────────────────────────────────
  {
    id: 'seq-actor', label: '参与者', category: 'sequence', w: 70, h: 110, view: '-6 -6 82 122',
    build: (): PresetElement[] => [
      { kind: 'ellipse', attrs: { cx: '35', cy: '12', rx: '12', ry: '12' } },
      { kind: 'line', attrs: { x1: '35', y1: '24', x2: '35', y2: '62' } },
      { kind: 'line', attrs: { x1: '12', y1: '38', x2: '58', y2: '38' } },
      { kind: 'line', attrs: { x1: '35', y1: '62', x2: '18', y2: '104' } },
      { kind: 'line', attrs: { x1: '35', y1: '62', x2: '52', y2: '104' } },
    ],
  },
  {
    id: 'seq-object', label: '对象', category: 'sequence', w: 140, h: 54, view: '-6 -6 152 66',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '140', height: '54' } }),
  },
  {
    id: 'seq-lifeline', label: '生命线', category: 'sequence', w: 0, h: 140, view: '-18 -10 36 160',
    build: () => ({ kind: 'line', attrs: { x1: '0', y1: '0', x2: '0', y2: '140', 'stroke-dasharray': '6 5' } }),
  },
  {
    id: 'seq-active', label: '激活条', category: 'sequence', w: 16, h: 120, view: '-6 -6 28 132',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '16', height: '120' } }),
  },
  {
    id: 'seq-sync', label: '同步消息', category: 'sequence', w: 150, h: 20, view: '-10 -6 170 32',
    build: (style): PresetElement[] => [
      { kind: 'line', attrs: { x1: '0', y1: '10', x2: '134', y2: '10' } },
      { kind: 'polygon', attrs: { points: pts([[134, 3], [150, 10], [134, 17]]), fill: style.stroke ?? 'currentColor' } },
    ],
  },
  {
    id: 'seq-async', label: '异步消息', category: 'sequence', w: 150, h: 20, view: '-10 -6 170 32',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 10 L 150 10 M 136 2 L 150 10 L 136 18' } }),
  },
  {
    id: 'seq-return', label: '返回消息', category: 'sequence', w: 150, h: 20, view: '-10 -6 170 32',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 10 L 134 10 M 136 3 L 150 10 L 136 17', 'stroke-dasharray': '7 5' } }),
  },
  {
    id: 'seq-self', label: '自消息', category: 'sequence', w: 90, h: 44, view: '-6 -6 102 56',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 6 L 50 6 L 50 30 L 76 30 M 66 22 L 78 30 L 66 38' } }),
  },
  {
    id: 'seq-frame', label: '组合片段', category: 'sequence', w: 190, h: 120, view: '-6 -6 202 132',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '190', height: '120' } },
      { kind: 'path', attrs: { d: 'M 0 0 L 64 0 L 52 26 L 0 26 Z' } },
    ],
  },

  // 数据流图 ──────────────────────────────────────────────────────────────────
  {
    id: 'dfd-entity', label: '外部实体', category: 'dataflow', w: 140, h: 70, view: '-6 -6 152 82',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '140', height: '70' } }),
  },
  {
    id: 'dfd-process', label: '过程', category: 'dataflow', w: 140, h: 80, view: '-6 -6 152 92',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '140', height: '80', rx: '18' } }),
  },
  {
    id: 'dfd-circle', label: '过程（圆）', category: 'dataflow', w: 90, h: 90, view: '-6 -6 102 102',
    build: () => ({ kind: 'ellipse', attrs: { cx: '45', cy: '45', rx: '45', ry: '45' } }),
  },
  {
    id: 'dfd-store-r', label: '数据存储（右开口）', category: 'dataflow', w: 150, h: 60, view: '-6 -6 162 72',
    build: () => ({ kind: 'path', attrs: { d: 'M 150 0 L 0 0 L 0 60 L 150 60' } }),
  },
  {
    id: 'dfd-store-l', label: '数据存储（左开口）', category: 'dataflow', w: 150, h: 60, view: '-6 -6 162 72',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 L 150 0 L 150 60 L 0 60' } }),
  },
  {
    id: 'dfd-store-lines', label: '数据存储（双线）', category: 'dataflow', w: 150, h: 50, view: '-6 -6 162 62',
    build: () => ({ kind: 'path', attrs: { d: 'M 0 0 L 150 0 M 0 7 L 150 7 M 0 43 L 150 43 M 0 50 L 150 50' } }),
  },

  // 实体关系图 ────────────────────────────────────────────────────────────────
  {
    id: 'er-entity2', label: '实体（2 格）', category: 'er', w: 170, h: 90, view: '-6 -6 182 102',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '170', height: '90' } },
      { kind: 'line', attrs: { x1: '0', y1: '32', x2: '170', y2: '32' } },
    ],
  },
  {
    id: 'er-entity3', label: '实体（3 格）', category: 'er', w: 170, h: 110, view: '-6 -6 182 122',
    build: (): PresetElement[] => [
      { kind: 'rect', attrs: { x: '0', y: '0', width: '170', height: '110' } },
      { kind: 'line', attrs: { x1: '0', y1: '32', x2: '170', y2: '32' } },
      { kind: 'line', attrs: { x1: '0', y1: '70', x2: '170', y2: '70' } },
    ],
  },
  {
    id: 'er-relation', label: '关系', category: 'er', w: 110, h: 60, view: '-6 -6 122 72',
    build: () => ({ kind: 'polygon', attrs: { points: pts([[55, 0], [110, 30], [55, 60], [0, 30]]) } }),
  },
  {
    id: 'er-attr', label: '属性', category: 'er', w: 110, h: 54, view: '-6 -6 122 66',
    build: () => ({ kind: 'ellipse', attrs: { cx: '55', cy: '27', rx: '55', ry: '27' } }),
  },

  // 组件图 ────────────────────────────────────────────────────────────────────
  {
    id: 'comp-box', label: '组件', category: 'component', w: 150, h: 90, view: '-6 -6 162 102',
    build: () => ({
      kind: 'path',
      attrs: {
        d: 'M 16 0 L 150 0 L 150 90 L 16 90 L 16 61 L 0 61 L 0 50 L 16 50 L 16 40 L 0 40 L 0 29 L 16 29 Z',
      },
    }),
  },
  {
    id: 'comp-lollipop', label: '提供接口', category: 'component', w: 120, h: 44, view: '-6 -6 132 56',
    build: (): PresetElement[] => [
      { kind: 'line', attrs: { x1: '0', y1: '22', x2: '96', y2: '22' } },
      { kind: 'ellipse', attrs: { cx: '108', cy: '22', rx: '12', ry: '12' } },
    ],
  },
  {
    id: 'comp-socket', label: '必需接口', category: 'component', w: 120, h: 44, view: '-6 -6 132 56',
    build: (): PresetElement[] => [
      { kind: 'line', attrs: { x1: '0', y1: '22', x2: '106', y2: '22' } },
      { kind: 'path', attrs: { d: 'M 106 11 A 11 11 0 0 1 106 33' } },
    ],
  },
  {
    id: 'comp-port', label: '端口', category: 'component', w: 18, h: 18, view: '-8 -8 34 34',
    build: () => ({ kind: 'rect', attrs: { x: '0', y: '0', width: '18', height: '18' } }),
  },
]

// ── 预览线稿 ─────────────────────────────────────────────────────────────────

/** 预览样式：currentColor 跟随按钮文字色（主题跟随） */
const PREVIEW_STYLE: Record<string, string> = {
  stroke: 'currentColor',
  'stroke-width': '1.5',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  fill: 'none',
}

const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

function markupOf(els: PresetElement[]): string {
  return els
    .map((el) => {
      const attrs = Object.entries(el.attrs)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}="${escAttr(v)}"`)
        .join(' ')
      return `<${el.kind} ${attrs}/>`
    })
    .join('')
}

/** 预览 SVG 内部标记（内置常量生成，无用户输入，v-html 安全） */
export function previewMarkup(p: ShapePreset): string {
  const built = p.build(PREVIEW_STYLE)
  // build 只产出几何与个别覆盖（如实心箭头 fill），预览样式在此统一兜底合并
  const list = (Array.isArray(built) ? built : [built]).map((el) => ({
    ...el,
    attrs: { ...PREVIEW_STYLE, ...el.attrs },
  }))
  return markupOf(list)
}
