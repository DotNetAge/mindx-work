/**
 * 便签：颜色预设、几何生成、渲染属性计算。
 * 语义形态 g > rect + text，attrs 承载 x/y/width/height/rx/fill（拖动位移走 transform），
 * 文字位置由便签几何推导（左上内边距 14/28），resize 走 rect 尺寸语义（字号不变）。
 * 序列化以 data-svgboard="sticky" 标记语义，外部查看器按普通 g 显示便签视觉。
 */
import type { BoardShape } from './types'

/** 便签四色（黄/粉/蓝/绿，浅底便签纸色） */
export const STICKY_COLORS = ['#f8e39e', '#f7c2cf', '#aed9f4', '#bfe3bc']

/** 便签默认尺寸（放置基准，resize 后以 attrs 为准） */
export const STICKY_W = 160
export const STICKY_H = 160

/** 放置：中心落在点击点 */
export function createSticky(id: number, cx: number, cy: number, color: string): BoardShape {
  return {
    id,
    kind: 'sticky',
    attrs: {
      x: String(Math.round(cx - STICKY_W / 2)),
      y: String(Math.round(cy - STICKY_H / 2)),
      width: String(STICKY_W),
      height: String(STICKY_H),
      rx: '8',
      fill: color,
    },
    text: '',
  }
}

/** 便签内文字渲染属性（左上对齐；深字通用浅底） */
export function stickyTextAttrs(s: BoardShape): Record<string, string> {
  const n = (v: string | undefined): number => Number(v) || 0
  return {
    x: String(n(s.attrs.x) + 14),
    y: String(n(s.attrs.y) + 28),
    'font-size': '16',
    'font-family': 'sans-serif',
    fill: '#1f2328',
  }
}

/** rect 渲染属性（剔除 transform，位移由外层 g 承载） */
export function stickyRectAttrs(s: BoardShape): Record<string, string> {
  const { transform: _t, ...rest } = s.attrs
  return rest
}
