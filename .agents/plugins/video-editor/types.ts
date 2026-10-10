/**
 * video-editor 数据模型：素材 / 片段（判别联合）/ 轨道 / 项目。
 * 时间单位一律秒；画布内坐标（文字、贴纸）一律 0..1 归一化，渲染时乘画布尺寸，
 * 保证 720p 预览与 1080p 导出一致。项目文件 .vedit = Project JSON。
 */

/** 素材类别：视频 / 音频 / 图片（图片在轨道上按时长摆放） */
export type AssetKind = 'video' | 'audio' | 'image'

/** 媒体素材：path 为本机绝对路径，url 为 mx-file 流地址，thumb 为封面 dataURL */
export interface MediaAsset {
  id: string
  path: string
  name: string
  kind: AssetKind
  url: string
  /** 秒；图片恒为 0 */
  duration: number
  width: number
  height: number
  /** 封面缩略图（jpeg dataURL，160x90；图片直接用自身帧；音频用空串走图标位） */
  thumb: string
}

/** 画面滤镜五参数（1 为中性；warmth 暖冷偏移 -1..1，blur 为像素） */
export interface ClipFilter {
  brightness: number
  contrast: number
  saturation: number
  warmth: number
  blur: number
}

/** 转场入型：无 / 淡入（叠加在黑底渐显）/ 叠化（与同轨前一片段尾帧交叉淡化） */
export type TransitionType = 'none' | 'fade' | 'dissolve'

export interface ClipTransition {
  type: TransitionType
  /** 秒 */
  duration: number
}

interface ClipBase {
  id: string
  /** 轨上起点（秒） */
  start: number
  /** 片段时长（秒）＝ 采出的素材区间时长 / 速度 */
  duration: number
  transitionIn: ClipTransition
}

/** 媒体片段：视频 / 音频轨上的一段素材引用 */
export interface MediaClip extends ClipBase {
  type: 'media'
  assetId: string
  /** 素材内入点（秒），出点 = inPoint + duration * speed */
  inPoint: number
  speed: number
  /** 0..1（视频片段含其自带音轨的音量；静音开关在轨道上） */
  volume: number
  /** 0..1 画面不透明度 */
  opacity: number
  filter: ClipFilter
}

/** 文字片段：x/y 为 0..1 归一化中心点坐标 */
export interface TextClip extends ClipBase {
  type: 'text'
  text: string
  /** 画布像素字号（基准为项目高度） */
  fontSize: number
  color: string
  strokeColor: string
  x: number
  y: number
}

/** 贴纸片段：emoji 字符渲染，x/y 归一化中心点 */
export interface StickerClip extends ClipBase {
  type: 'sticker'
  emoji: string
  /** 画布像素字号 */
  size: number
  x: number
  y: number
}

export type Clip = MediaClip | TextClip | StickerClip

/** 轨道类别：video（画面层，含音频）/ audio（纯音频）/ text（文字与贴纸） */
export type TrackKind = 'video' | 'audio' | 'text'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  /** 仅 video 轨有意义：隐藏后不参与渲染 */
  hidden: boolean
  clips: Clip[]
}

/** 项目（.vedit 文件本体）：video 轨数组序即叠层序（index 0 最底层） */
export interface Project {
  version: 1
  name: string
  width: number
  height: number
  fps: number
  tracks: Track[]
  assets: MediaAsset[]
}

/** 滤镜中性值工厂（避免散落字面量） */
export function neutralFilter(): ClipFilter {
  return { brightness: 1, contrast: 1, saturation: 1, warmth: 0, blur: 0 }
}

/** 全项目时长（秒）：各轨片段末端最大值，空项目为 0 */
export function projectDuration(project: Project): number {
  let end = 0
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration)
    }
  }
  return end
}

/** 媒体片段的素材内出点（秒） */
export function mediaOutPoint(clip: MediaClip): number {
  return clip.inPoint + clip.duration * clip.speed
}

/** 时间格式化：秒 → mm:ss.d（时间线刻度与属性面板共用） */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const mm = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  const d = Math.floor((s % 1) * 10)
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${d}`
}
