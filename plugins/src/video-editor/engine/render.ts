/**
 * 帧渲染引擎：把项目状态画到 2D 画布（预览画布与导出离屏画布共用同一实现）。
 * 绘制顺序：video 轨（数组序，index 0 最底层）→ text 轨（文字 / 贴纸，数组序）。
 * 素材适配画布用 cover 策略（等比放大居中裁切，与剪映默认一致）。
 * 滤镜经 ctx.filter（Chromium 支持 brightness/contrast/saturate/blur），
 * warmth 用叠加层（soft-light 混合暖 / 冷色）实现暖冷调。
 * 转场：fade 在黑底渐显；dissolve 先画同轨前一片段的尾帧再交叉淡化本片段。
 */

import type { Clip, MediaAsset, MediaClip, Project, StickerClip, TextClip, Track } from '../types'
import type { MediaPool } from './mediaPool'

/** 轨道过滤词：文字与贴纸共用 text 轨 */
const TEXT_TRACK_KIND = 'text' as const

export interface RenderContext {
  project: Project
  pool: MediaPool
  resolve: (assetId: string) => MediaAsset | null
}

/** cover 适配：等比放大铺满画布并居中裁切 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  w: number,
  h: number,
): void {
  if (sw <= 0 || sh <= 0) return
  const scale = Math.max(w / sw, h / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/** 滤镜串（空串 = 中性，避免每帧重置 filter 的开销） */
function filterString(brightness: number, contrast: number, saturation: number, blur: number): string {
  const parts: string[] = []
  if (brightness !== 1) parts.push(`brightness(${brightness})`)
  if (contrast !== 1) parts.push(`contrast(${contrast})`)
  if (saturation !== 1) parts.push(`saturate(${saturation})`)
  if (blur > 0) parts.push(`blur(${blur}px)`)
  return parts.join(' ')
}

/** 暖冷调叠加：warmth > 0 暖橙、< 0 冷蓝（soft-light 混合，幅度按 |warmth|） */
function applyWarmth(ctx: CanvasRenderingContext2D, warmth: number, w: number, h: number): void {
  if (warmth === 0) return
  const alpha = Math.min(0.45, Math.abs(warmth) * 0.45)
  ctx.save()
  ctx.globalCompositeOperation = 'soft-light'
  ctx.fillStyle = warmth > 0 ? `rgba(255,150,40,${alpha})` : `rgba(40,120,255,${alpha})`
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/**
 * 画媒体片段（画面轨）：元素当前帧即正确帧（播放同步由 mediaPool 负责），
 * 这里只做滤镜 + 不透明度包裹。overrideElement 供 dissolve 交叉源传影子元素
 * （同素材相邻片段共享主元素，前段画面必须取自影子）。
 */
function drawMediaClip(ctx: CanvasRenderingContext2D, rc: RenderContext, clip: MediaClip, overrideElement?: HTMLVideoElement): void {
  const asset = rc.resolve(clip.assetId)
  if (!asset) return
  const { width: w, height: h } = rc.project
  const element = overrideElement ?? rc.pool.videoElementOf(asset)
  if (!element) return
  if (asset.kind === 'image' && !overrideElement) {
    if (!(element as unknown as HTMLImageElement).complete) return
  } else {
    const video = element as HTMLVideoElement
    if (video.readyState < 2) return
  }
  const alpha = clip.opacity
  if (alpha <= 0) return
  ctx.save()
  if (alpha < 1) ctx.globalAlpha *= alpha
  ctx.filter = filterString(clip.filter.brightness, clip.filter.contrast, clip.filter.saturation, clip.filter.blur)
  const sw = asset.kind === 'image' ? (element as unknown as HTMLImageElement).naturalWidth : (element as HTMLVideoElement).videoWidth
  const sh = asset.kind === 'image' ? (element as unknown as HTMLImageElement).naturalHeight : (element as HTMLVideoElement).videoHeight
  drawCover(ctx, element, sw, sh, w, h)
  ctx.filter = 'none'
  applyWarmth(ctx, clip.filter.warmth, w, h)
  ctx.restore()
}

/** 找同轨紧邻本片段之前的一个片段（dissolve 交叉源） */
function previousClip(track: Track, clip: Clip): Clip | null {
  let best: Clip | null = null
  for (const other of track.clips) {
    if (other.id === clip.id) continue
    if (other.start + other.duration <= clip.start + 1e-6) {
      if (!best || other.start + other.duration > best.start + best.duration) best = other
    }
  }
  return best
}

/** 画媒体片段含转场（fade / dissolve 入场窗口内渐显） */
function drawMediaWithTransition(
  ctx: CanvasRenderingContext2D,
  rc: RenderContext,
  track: Track,
  clip: MediaClip,
  t: number,
): void {
  const trans = clip.transitionIn
  const inWindow = trans.type !== 'none' && trans.duration > 0 && t < clip.start + trans.duration
  if (!inWindow) {
    drawMediaClip(ctx, rc, clip)
    return
  }
  const progress = Math.max(0, Math.min(1, (t - clip.start) / trans.duration))
  if (trans.type === 'dissolve') {
    // 前段画面取交叉期影子元素帧（syncAll 已同步其位置；影子仅视频素材会建，
    // 图片 / 音频源回退主元素——图片池按素材隔离无共享冲突）
    const prev = previousClip(track, clip)
    if (prev && prev.type === 'media') {
      const shadow = rc.pool.shadowElementOf(prev.id)
      drawMediaClip(ctx, rc, prev, shadow ?? undefined)
    }
  }
  const before = ctx.globalAlpha
  ctx.globalAlpha = before * progress
  drawMediaClip(ctx, rc, clip)
  ctx.globalAlpha = before
}

function drawTextClip(ctx: CanvasRenderingContext2D, clip: TextClip, t: number, w: number, h: number): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${clip.fontSize}px -apple-system, 'PingFang SC', sans-serif`
  const cx = clip.x * w
  const cy = clip.y * h
  const trans = clip.transitionIn
  // 文字转场：窗口内按进度渐入（与媒体片段 fade 同语义）
  if (trans.type !== 'none' && trans.duration > 0 && t < clip.start + trans.duration) {
    ctx.globalAlpha = Math.max(0, Math.min(1, (t - clip.start) / trans.duration))
  }
  if (clip.strokeColor) {
    ctx.lineWidth = Math.max(2, clip.fontSize / 9)
    ctx.strokeStyle = clip.strokeColor
    ctx.lineJoin = 'round'
    ctx.strokeText(clip.text, cx, cy)
  }
  ctx.fillStyle = clip.color
  ctx.fillText(clip.text, cx, cy)
  ctx.restore()
}

function drawStickerClip(ctx: CanvasRenderingContext2D, clip: StickerClip, w: number, h: number): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${clip.size}px 'Apple Color Emoji', sans-serif`
  ctx.fillText(clip.emoji, clip.x * w, clip.y * h)
  ctx.restore()
}

/** 单轨绘制（分派片段类别；muted 只作用于音频，不跳画面） */
function drawTrack(ctx: CanvasRenderingContext2D, rc: RenderContext, track: Track, t: number): void {
  if (track.hidden) return
  const { width: w, height: h } = rc.project
  for (const clip of track.clips) {
    if (t < clip.start || t >= clip.start + clip.duration) continue
    if (clip.type === 'media') drawMediaWithTransition(ctx, rc, track, clip, t)
    else if (clip.type === 'text') drawTextClip(ctx, clip as TextClip, t, w, h)
    else if (clip.type === 'sticker') drawStickerClip(ctx, clip as StickerClip, w, h)
  }
}

// ── 轨道分组缓存：renderFrame 每帧调用，避免每帧两次 filter 重建数组（热路径）──
// 键失效条件 = tracks 数组引用或长度变化（本编辑器无删轨，trackFor 追加会变长度；
// 换项目 / 导出快照都是新数组引用，自动失效）
let cachedTracksRef: Track[] | null = null
let cachedTracksLen = -1
let cachedVideoTracks: Track[] = []
let cachedTextTracks: Track[] = []

function splitTracks(tracks: Track[]): void {
  if (tracks === cachedTracksRef && tracks.length === cachedTracksLen) return
  cachedVideoTracks = []
  cachedTextTracks = []
  for (const track of tracks) {
    if (track.kind === TEXT_TRACK_KIND) cachedTextTracks.push(track)
    else cachedVideoTracks.push(track)
  }
  cachedTracksRef = tracks
  cachedTracksLen = tracks.length
}

/** 渲染一帧（t 为项目时间，秒）：黑底打底，按轨序绘制全部可见轨 */
export function renderFrame(ctx: CanvasRenderingContext2D, rc: RenderContext, t: number): void {
  const { width: w, height: h } = rc.project
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
  splitTracks(rc.project.tracks)
  for (const track of cachedVideoTracks) drawTrack(ctx, rc, track, t)
  for (const track of cachedTextTracks) drawTrack(ctx, rc, track, t)
}
