/**
 * 媒体元素池与播放同步：懒建 video / audio / image 元素（key = assetId，全项目
 * 复用），负责把时间轴状态翻译成元素行为（play / pause / seek / 倍速）。
 * 音频链路：per 元素 createMediaElementSource（一次性，必须缓存——同一元素重复
 * create 会抛错）→ GainNode → AudioContext destination；导出时 GainNode 同时
 * 连接 MediaStreamDestination 供 MediaRecorder 采集。漂移校准：播放期期望素材
 * 时间与元素实际时间差 > 0.3s 才 seek（防逐帧抖动）。
 * dissolve 转场：交叉期为前段片段另建影子 video 元素（key = clip.id，按需创建、
 * 交叉结束即释放）——同素材相邻片段共享主元素时，前段画面不再被后段覆盖。
 */

import type { MediaAsset, MediaClip } from '../types'

/** 漂移校准阈值（秒）：低于它不 seek，靠自然播放对齐 */
const DRIFT_TOLERANCE = 0.3

/** 媒体资产查找器：由 store 提供（assets 数组响应式，避免复制进池） */
export type AssetResolver = (assetId: string) => MediaAsset | null

interface PoolEntry {
  element: HTMLVideoElement | HTMLAudioElement
  gain: GainNode | null
}

export class MediaPool {
  private readonly pool = new Map<string, PoolEntry>()
  private readonly images = new Map<string, HTMLImageElement>()
  /** dissolve 交叉期的前段影子元素（key = 前段 clip.id，仅视频素材） */
  private readonly shadows = new Map<string, HTMLVideoElement>()
  private audioCtx: AudioContext | null = null
  private exportDest: MediaStreamAudioDestinationNode | null = null

  /** 取（或懒建）媒体元素；预览期音频直连扬声器 */
  private entry(asset: MediaAsset): PoolEntry {
    const hit = this.pool.get(asset.id)
    if (hit) return hit
    if (asset.kind === 'audio') {
      const element = document.createElement('audio')
      element.preload = 'auto'
      element.crossOrigin = 'anonymous'
      element.src = asset.url
      const { gain } = this.attachAudio(element)
      const created: PoolEntry = { element, gain }
      this.pool.set(asset.id, created)
      return created
    }
    const element = document.createElement('video')
    element.preload = 'auto'
    element.crossOrigin = 'anonymous'
    element.src = asset.url
    const { gain } = this.attachAudio(element)
    const created: PoolEntry = { element, gain }
    this.pool.set(asset.id, created)
    return created
  }

  /** 建音频链（source 一次性缓存）：返回 gain（context 建不起来时为 null，走静默降级） */
  private attachAudio(element: HTMLMediaElement): { gain: GainNode | null } {
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext()
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume()
      const source = this.audioCtx.createMediaElementSource(element)
      const gain = this.audioCtx.createGain()
      source.connect(gain)
      gain.connect(this.audioCtx.destination)
      // 导出流已开（元素在导出中途才懒建的场景）：新 gain 同步接入导出路由
      if (this.exportDest) gain.connect(this.exportDest)
      return { gain }
    } catch {
      return { gain: null }
    }
  }

  /** 导出期调用：把主增益链额外接入 MediaStreamDestination（返回其音频流） */
  ensureExportStream(): MediaStream | null {
    if (!this.audioCtx) return null
    if (!this.exportDest) {
      this.exportDest = this.audioCtx.createMediaStreamDestination()
      // 主路由（destination）与导出路由并行：所有 gain 已连 destination，
      // 导出再连一次 exportDest 即双写
      for (const { gain } of this.pool.values()) {
        if (gain) gain.connect(this.exportDest)
      }
    }
    return this.exportDest.stream
  }

  /** 图片元素（懒建；跨源标记保证 canvas 可读） */
  imageOf(asset: MediaAsset): HTMLImageElement | null {
    const hit = this.images.get(asset.id)
    if (hit) return hit
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = asset.url
    this.images.set(asset.id, img)
    return img
  }

  /** 供渲染层取画面元素（video 轨 drawImage 源；未 ready 返回 null 由渲染跳帧） */
  videoElementOf(asset: MediaAsset): HTMLVideoElement | null {
    if (asset.kind === 'image') return this.imageOf(asset) as unknown as HTMLVideoElement
    return this.entry(asset).element as HTMLVideoElement
  }

  /**
   * 播放状态同步：对单个媒体片段施加时间轴意志（t 为项目时间，秒），返回是否
   * 窗内（窗内片段的素材由调用方记入活跃集合）。volume 由调用方换算（含轨静音）。
   * 窗外片段完全不动作：同素材多片段共享同一元素，任何 seek/暂停都会破坏窗内
   * 片段的播放位置——pause 裁决由 syncAll 在收集齐活跃集合后统一做（pauseElement）。
   */
  syncClip(clip: MediaClip, asset: MediaAsset | null, t: number, playing: boolean, volume: number): boolean {
    if (!asset) return false
    if (asset.kind === 'image') {
      this.imageOf(asset)
      return true
    }
    if (t < clip.start || t >= clip.start + clip.duration) return false
    const { element, gain } = this.entry(asset)
    if (gain) gain.gain.value = Math.max(0, Math.min(1, volume))
    const expect = clip.inPoint + (t - clip.start) * clip.speed
    element.playbackRate = Math.max(0.0625, Math.min(16, clip.speed))
    if (Math.abs(element.currentTime - expect) > DRIFT_TOLERANCE) {
      element.currentTime = expect
    }
    if (playing) {
      if (element.paused) void element.play().catch(() => {})
    } else {
      element.pause()
      if (Math.abs(element.currentTime - expect) > 0.05) element.currentTime = expect
    }
    return true
  }

  /**
   * dissolve 交叉期影子元素同步（仅视频素材；影子静音仅供渲染取帧，交叉期
   * 音频由窗内元素承担）。expect 越素材末端时元素自然停在尾帧（可接受降级）。
   */
  syncShadow(clip: MediaClip, asset: MediaAsset, t: number, playing: boolean): void {
    if (asset.kind !== 'video') return
    let element = this.shadows.get(clip.id)
    if (!element) {
      element = document.createElement('video')
      element.preload = 'auto'
      element.crossOrigin = 'anonymous'
      element.muted = true
      element.src = asset.url
      this.shadows.set(clip.id, element)
    }
    const expect = clip.inPoint + (t - clip.start) * clip.speed
    element.playbackRate = Math.max(0.0625, Math.min(16, clip.speed))
    if (Math.abs(element.currentTime - expect) > DRIFT_TOLERANCE) {
      element.currentTime = expect
    }
    if (playing) {
      if (element.paused) void element.play().catch(() => {})
    } else {
      element.pause()
      if (Math.abs(element.currentTime - expect) > 0.05) element.currentTime = expect
    }
  }

  /** 渲染层取影子元素（dissolve 交叉源帧；未建返回 null 由调用方回退主元素） */
  shadowElementOf(clipId: string): HTMLVideoElement | null {
    return this.shadows.get(clipId) ?? null
  }

  /** 释放不在活跃集合内的影子元素（交叉结束即弃） */
  pruneShadows(activeKeys: Set<string>): void {
    for (const [key, element] of this.shadows) {
      if (activeKeys.has(key)) continue
      this.releaseShadow(element)
      this.shadows.delete(key)
    }
  }

  /** 暂停某素材已存在的元素（不懒建；窗外防漏音裁决由 store.syncAll 统一发起） */
  pauseElement(asset: MediaAsset): void {
    const hit = this.pool.get(asset.id)
    if (hit) hit.element.pause()
  }

  /** 断开源并释放单个影子元素 */
  private releaseShadow(element: HTMLVideoElement): void {
    element.pause()
    element.removeAttribute('src')
    element.load()
  }

  /** 暂停池内全部元素并释放影子（切项目 / 卸载时） */
  pauseAll(): void {
    for (const { element } of this.pool.values()) element.pause()
    for (const element of this.shadows.values()) this.releaseShadow(element)
    this.shadows.clear()
  }

  /** 释放全部（dispose：断开源，允许 GC） */
  dispose(): void {
    for (const { element } of this.pool.values()) {
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
    this.pool.clear()
    for (const element of this.shadows.values()) this.releaseShadow(element)
    this.shadows.clear()
    this.images.clear()
    void this.audioCtx?.close().catch(() => {})
    this.audioCtx = null
    this.exportDest = null
  }
}
