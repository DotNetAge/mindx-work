/**
 * 导出 PNG：画布序列化文本 → 离屏 canvas 2x 白底渲染 → dataURL。
 * 注入 width/height 保证 Image 解码尺寸明确（viewBox 单独存在时部分内核不渲染）。
 */
import type { View } from './types'

/** 渲染倍率（导出清晰度） */
const SCALE = 2

export async function exportPng(svgText: string, docBox: View): Promise<string> {
  const sized = svgText.replace(
    '<svg ',
    `<svg width="${docBox.w}" height="${docBox.h}" `,
  )
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG 渲染失败'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(docBox.w * SCALE)
    canvas.height = Math.round(docBox.h * SCALE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 不可用')
    // 白底：画板即纸面，透明区域落白
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
