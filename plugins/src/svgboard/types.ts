/**
 * svgboard 共享类型与常量：画布图形模型、视口矩形、工具集。
 * 从 DetailPanel 抽取，供 viewport / history / clipboard / shapes-geometry 复用。
 */

/** 视口/文档边界矩形（svg 坐标） */
export interface View {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 画布图形：attrs 直接序列化落盘（几何与样式属性并入）。
 * text 的内容在 text 字段；group 单层不嵌套（编组展平语义），children 必有。
 * connFrom/connTo 为连接线两端引用的图形 id（悬空即自由线，序列化为 data-conn-*）。
 */
export interface BoardShape {
  id: number
  kind: 'rect' | 'ellipse' | 'line' | 'path' | 'polygon' | 'text' | 'group' | 'sticky'
  attrs: Record<string, string>
  text?: string
  children?: BoardShape[]
  connFrom?: number
  connTo?: number
}

/** 画板工具：选择/绘制七工具 + 便签 + 连接线 + 平移抓手 + 橡皮擦 */
export type Tool =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'pencil'
  | 'text'
  | 'sticky'
  | 'spline'
  | 'eraser'
  | 'hand'
