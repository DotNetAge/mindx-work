/**
 * 媒体探测：读取素材元数据（时长 / 尺寸）并生成封面缩略图。
 * 视频封面：隐藏 video 元素加载 mx-file 流 → seek 至 25% 处 → drawImage 缩到
 * 160x90 canvas → toDataURL。音频无画面，封面空串（素材库走图标位）。
 * 所有元素用完即弃（探测一次性，不进播放元素池）。
 */

import type { AssetKind, MediaAsset } from '../types'

/** 流地址构造：逐段 encodeURIComponent（禁 encodeURI，与 video-viewer 同源） */
export function streamUrlOf(path: string): string {
  return `mx-file://local${path.split('/').map(encodeURIComponent).join('/')}`
}

/** 按扩展名判类别（导入过滤同口径） */
export function kindOfExt(name: string): AssetKind | null {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'].includes(ext)) return 'video'
  if (['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  return null
}

/** 视频帧封面：seek 到 25% 处抓帧（Seek 完成回调返回，超时 8s 放弃置空） */
function grabVideoThumb(url: string): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.crossOrigin = 'anonymous'
    let settled = false
    const finish = (thumb: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(thumb)
    }
    const timer = setTimeout(() => finish(''), 8000)
    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(video.duration * 0.25, 1)
    })
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 90
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish('')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.6))
      } catch {
        finish('')
      }
    })
    video.addEventListener('error', () => finish(''))
    video.src = url
  })
}

/**
 * 等待媒体元数据就绪（8s 超时兜底）。duration 为 Infinity 的流式容器（webm
 * 录屏等常见）用极限 seek 触发 durationchange 的标准手法取真实时长；拿不到
 * 则 reject（该素材判为失败不导入，Infinity 落盘会变 null 污染项目文件）。
 */
function awaitMetadata(el: HTMLMediaElement, timeoutMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      el.removeEventListener('loadedmetadata', onLoadedMetadata)
      el.removeEventListener('durationchange', onDurationChange)
      el.removeEventListener('error', onError)
      clearTimeout(timer)
    }
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), 8000)
    const durationReady = (): boolean => Number.isFinite(el.duration) && el.duration > 0
    const onLoadedMetadata = (): void => {
      if (durationReady()) {
        finish(resolve)
        return
      }
      // 极限 seek：Chromium 对 Infinity 时长的标准探测手法
      el.addEventListener('durationchange', onDurationChange)
      el.currentTime = 1e101
    }
    const onDurationChange = (): void => {
      if (!durationReady()) return
      el.currentTime = 0
      finish(resolve)
    }
    const onError = (): void => finish(() => reject(new Error(timeoutMessage)))
    el.addEventListener('loadedmetadata', onLoadedMetadata)
    el.addEventListener('error', onError)
  })
}

/** 探测单个素材：元数据必成（失败抛错由调用方提示），缩略图尽力而为 */
export async function probeAsset(path: string, kind: AssetKind): Promise<Omit<MediaAsset, 'id' | 'path' | 'name' | 'kind'>> {
  const url = streamUrlOf(path)
  if (kind === 'image') {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        resolve({ url, duration: 0, width: img.naturalWidth, height: img.naturalHeight, thumb: url })
      }
      img.onerror = () => reject(new Error('图片无法加载'))
      img.src = url
    })
  }
  if (kind === 'audio') {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    try {
      await awaitMetadata(audio, '音频无法解码（读取超时或编码不受支持）')
    } finally {
      audio.removeAttribute('src')
      audio.load()
    }
    return { url, duration: audio.duration, width: 0, height: 0, thumb: '' }
  }
  const video = document.createElement('video')
  video.preload = 'metadata'
  try {
    await awaitMetadata(video, '视频无法解码（读取超时或容器/编码不受支持）')
  } finally {
    video.removeAttribute('src')
    video.load()
  }
  const meta = { url, duration: video.duration, width: video.videoWidth, height: video.videoHeight, thumb: '' }
  // 封面抓帧用独立元素（grabVideoThumb 自带 8s 超时且只 resolve 不 reject），
  // 探测不因缩略图失败而失败
  meta.thumb = await grabVideoThumb(url)
  return meta
}
