/**
 * 图片工具（desktop services/imageUpload 纯函数部分平移）。
 * RPC 通道（fs.write_base64 落盘 / fs.read_base64 读取 / fs.rm 清理）在
 * chatflow store action 落位，此处仅 Mime 判定与扩展名互推。
 */

/** 支持的图片 MIME 类型（LLM 多模态常见输入格式） */
const SUPPORTED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function isSupportedImageMime(mime: string): boolean {
  return SUPPORTED_MEDIA_TYPES.has(mime)
}

/** 由 MIME 推断文件扩展名（落盘命名用） */
export function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'png'
  }
}

/** 由文件扩展名推断 MIME 类型（读取渲染兜底用） */
export function mimeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}
