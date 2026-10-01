/**
 * 本地文件流协议模块（主进程）：mx-file://<绝对路径> 的大文件流式读取通道。
 * 为什么不用 daemon fs.read_base64：整读 base64 会把整份文件装进内存与 IPC，
 * 视频等大文件不可行；且 <video> 拖动进度条依赖 HTTP Range 请求——协议 handler
 * 自行解析 Range 头返回 206 分段流，seek 才能即点即放。
 * 安全边界：接受任意本机绝对路径，与 terminal pty（任意 cwd 执行命令）同权，
 * 本机桌面应用语境下不构成新增放大面；协议仅供应用内 <video>/<audio> 消费。
 */
import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'

/** 特权声明：standard 让 mx-file:///… 可作标准 URL；stream 允许响应为流。
 * 必须在 app.ready 之前执行（与 plugins.ts 的 mx-plugin 声明同为模块加载期） */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mx-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/** 扩展名 → MIME（可直播的媒体形态；未知回落 octet-stream 由 <video> 报错降级） */
const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
}

function mimeOf(filePath: string): string {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

/** 解析 Range 头（bytes=start-end / bytes=-suffix）；无 Range 或形态非法返回 null */
function parseRange(header: string | null, total: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  if (match[1] === '') {
    // 后缀形态：bytes=-N（取末 N 字节）
    const suffix = Number(match[2])
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1)
  return { start, end }
}

/** 注册 mx-file handler（app.ready 后调用）：Range 分段流式读本地文件 */
export function registerFileStreamProtocol(): void {
  protocol.handle('mx-file', async (request) => {
    // mx-file://local/<逐段 encodeURIComponent 的绝对路径>，pathname 还原即路径
    let filePath: string
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('URL 无法解析', { status: 400 })
    }
    let total: number
    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) return new Response('不是常规文件', { status: 400 })
      total = stat.size
    } catch {
      return new Response('文件不存在或不可访问', { status: 404 })
    }
    const mime = mimeOf(filePath)
    const range = parseRange(request.headers.get('Range'), total)
    if (range) {
      if (range.start > range.end || range.start >= total) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        })
      }
      const stream = createReadStream(filePath, { start: range.start, end: range.end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }
    const stream = createReadStream(filePath)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
      },
    })
  })
}
