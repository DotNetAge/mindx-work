/**
 * 导出引擎：离屏画布（项目分辨率）实时渲染整条时间轴，MediaRecorder 采集
 * 画面流（captureStream）+ 音频流（mediaPool 的 MediaStreamDestination）合成
 * webm。流程：建录制器 → 复位播放头到 0 → 驱动播放（与预览同一同步机制）→
 * 到达总时长停止 → blob 转 base64 → 调用方落盘。进度经 onProgress 上报
 * （0..1）。编码候选按支持度降级（vp9 → vp8 → 默认）。
 */

import { projectDuration } from '../types'
import type { MediaPool } from './mediaPool'
import { renderFrame } from './render'
import type { RenderContext } from './render'

/** 浏览器编码支持探测（首个支持的项；全不支持回落默认 webm） */
function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return mime
  }
  return 'video/webm'
}

/**
 * base64 分块转换（大 blob 防单次 btoa 栈溢出）。
 * 通道内存限制说明：blob → dataURL → base64 字符串 → RPC JSON 转义共四段驻留，
 * 峰值约为文件体积的 4-6 倍；受 fs.write_base64 文本通道约束无法流式，属已知
 * 边界（协议级重构风险大，不在本次范围）。
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // dataURL 串只在闭包内短暂存活，onload 返回后即可被 GC 回收
      // （reader.result 是只读属性，无法主动置空；全链路内存放大见上注）
      const dataUrl = String(reader.result)
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('导出数据读取失败'))
    reader.readAsDataURL(blob)
  })
}

export interface ExportOptions {
  rc: RenderContext
  pool: MediaPool
  /** 播放驱动回调：导出期间同步层走它（与预览一致） */
  sync: (t: number, playing: boolean) => void
  onProgress: (progress: number) => void
  signal: { aborted: boolean }
}

export interface ExportResult {
  base64: string
  /** 实际产出的媒体类型（文件扩展名据此取 webm） */
  mime: string
}

/** 执行导出：整段实时渲染并录制，完成返回 base64（取消时抛 ExportCancelled） */
export class ExportCancelled extends Error {
  constructor() {
    super('导出已取消')
  }
}

export async function runExport(options: ExportOptions): Promise<ExportResult> {
  const { rc, pool, sync, onProgress, signal } = options
  const { project } = rc
  const duration = projectDuration(project)
  if (duration <= 0) throw new Error('时间轴为空，没有可导出的内容')

  const canvas = document.createElement('canvas')
  canvas.width = project.width
  canvas.height = project.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布上下文不可用')

  const fps = project.fps
  const videoStream = canvas.captureStream(fps)
  const tracks = [...videoStream.getVideoTracks()]
  // 音频流（可能为 null：纯图形项目无音频链）
  const audioStream = pool.ensureExportStream()
  if (audioStream) tracks.push(...audioStream.getAudioTracks())
  const stream = new MediaStream(tracks)

  const mime = pickMime()
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  // 编码器故障（磁盘/编解码器异常等）：走失败路径而非静默产出不完整文件
  const failed = new Promise<never>((_, reject) => {
    recorder.onerror = () => reject(new Error('录制过程发生错误，导出中止'))
  })

  recorder.start(250)

  // 实时渲染驱动：从 0 播到总时长（与预览共用同步与渲染实现）
  const startWall = performance.now()
  const renderLoop = new Promise<void>((resolve) => {
    const step = (): void => {
      if (signal.aborted) {
        resolve()
        return
      }
      const t = (performance.now() - startWall) / 1000
      const clamped = Math.min(t, duration)
      sync(clamped, true)
      renderFrame(ctx, rc, clamped)
      onProgress(Math.min(1, t / duration))
      if (t >= duration) {
        resolve()
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  try {
    await Promise.race([renderLoop, failed])
  } catch (e) {
    // 置取消标记让渲染循环下一帧自行退出；收尾后抛可读错误
    signal.aborted = true
    try {
      recorder.stop()
    } catch {
      // 录制器已停止时忽略
    }
    pool.pauseAll()
    throw e instanceof Error ? e : new Error(String(e))
  }

  recorder.stop()
  await done
  pool.pauseAll()
  sync(Math.min(duration, (performance.now() - startWall) / 1000), false)

  if (signal.aborted) throw new ExportCancelled()
  const blob = new Blob(chunks, { type: mime })
  const base64 = await blobToBase64(blob)
  return { base64, mime }
}
