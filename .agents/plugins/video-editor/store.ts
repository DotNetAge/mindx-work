/**
 * video-editor 插件 store：项目状态（Model）与全部编辑动作。
 * 数据通道：daemon fs.*（fs.list / fs.write / fs.write_base64 / fs.read_base64）
 * + window.mxDesktop.dialog.saveFile（系统保存对话框）。项目文件 .vedit =
 * Project JSON。播放循环由 store 自持 rAF（tick 推进播放头并同步媒体元素），
 * 预览与导出共用同一同步实现（pool.syncClip）。壳引用装配期捕获，store 顶部
 * 零 inject 依赖。
 */

import { computed, markRaw, ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'
import { MediaPool } from './engine/mediaPool'
import { runExport } from './engine/exporter'
import { probeAsset, kindOfExt } from './engine/probe'
import {
  mediaOutPoint,
  neutralFilter,
  projectDuration,
  type Clip,
  type MediaAsset,
  type MediaClip,
  type Project,
  type StickerClip,
  type TextClip,
  type Track,
  type TrackKind,
} from './types'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const VIDEO_EDITOR_DETAIL_ID = 'video-editor-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindVideoEditorShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('video-editor 壳未绑定：插件装配缺失')
  return shellRef
}

// ── 消费侧服务形状声明 ───────────────────────────────────────────────────────

interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 短 id 生成（片段 / 轨道 / 素材共用；randomUUID 不可用时降级计数器） */
let uidCounter = 0
function uid(prefix: string): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `${prefix}-${c.randomUUID().slice(0, 8)}`
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`
}

/** 新建空白项目：默认三轨（画面 / 声音 / 文字） */
function emptyProject(): Project {
  return {
    version: 1,
    name: '未命名项目',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      { id: uid('trk'), kind: 'video', name: '画面 1', muted: false, hidden: false, clips: [] },
      { id: uid('trk'), kind: 'audio', name: '声音 1', muted: false, hidden: false, clips: [] },
      { id: uid('trk'), kind: 'text', name: '文字 1', muted: false, hidden: false, clips: [] },
    ],
    assets: [],
  }
}

// ── store ────────────────────────────────────────────────────────────────────

export const useVideoEditorStore = defineStore('video-editor-store', () => {
  const daemon = theShell().services.use<DaemonConnection>('daemon.connection')

  /** 媒体元素池（markRaw：元素本体不进 Vue 响应式依赖图） */
  const pool = markRaw(new MediaPool())

  // ── 项目状态 ───────────────────────────────────────────────────────────────
  const project = ref<Project>(emptyProject())
  /** 当前项目文件绝对路径（空 = 未落盘的新项目） */
  const currentFile = ref('')
  const dirty = ref(false)
  const loading = ref(false)
  const error = ref('')

  // ── 编辑器视图状态 ─────────────────────────────────────────────────────────
  /** 选中片段 id（跨轨全局唯一） */
  const selectedClipId = ref('')
  /** 时间线横向缩放（像素 / 秒） */
  const pxPerSec = ref(60)
  /** 播放头（秒） */
  const playhead = ref(0)
  const playing = ref(false)

  // ── 导出状态 ───────────────────────────────────────────────────────────────
  const exporting = ref(false)
  const exportProgress = ref(0)
  const exportMessage = ref('')
  let exportAbort = { aborted: false }

  const duration = computed(() => projectDuration(project.value))

  /** 素材查找（渲染层 / 同步层共用） */
  function resolveAsset(assetId: string): MediaAsset | null {
    return project.value.assets.find((a) => a.id === assetId) ?? null
  }

  /** 查片段所在轨（未命中返回 null） */
  function locateClip(clipId: string): { track: Track; clip: Clip } | null {
    for (const track of project.value.tracks) {
      const clip = track.clips.find((c) => c.id === clipId)
      if (clip) return { track, clip }
    }
    return null
  }

  /** 标记未保存改动（所有 mutation 出口） */
  function touch(): void {
    dirty.value = true
  }

  // ── 项目生命周期 ───────────────────────────────────────────────────────────

  /** 脏项目放弃确认（新建 / 打开共用；原生 confirm，壳内无统一确认范式） */
  function confirmDiscardDirty(): boolean {
    return !dirty.value || window.confirm('当前项目有未保存的修改，确定要放弃吗？')
  }

  /** 新建空白项目（未落盘态；保存时走系统对话框选路径） */
  function create(): void {
    if (exporting.value) return
    if (!confirmDiscardDirty()) return
    pool.pauseAll()
    project.value = emptyProject()
    currentFile.value = ''
    selectedClipId.value = ''
    playhead.value = 0
    playing.value = false
    dirty.value = false
    error.value = ''
    theShell().Detail.show(VIDEO_EDITOR_DETAIL_ID)
  }

  /** 打开 .vedit 项目文件（JSON 读回还原） */
  async function open(target: string): Promise<void> {
    const path = target.trim().replace(/:\d+(-\d+)?$/, '')
    if (!path) return
    if (exporting.value) return
    if (!confirmDiscardDirty()) return
    loading.value = true
    error.value = ''
    try {
      const result = await daemon.call<{ content: string; mime: string }>('fs.read_base64', { path })
      // fs.read_base64 返回字节级 base64（Go 侧 os.ReadFile 后 StdEncoding）；atob 按
      // Latin-1 逐字符解码会把 UTF-8 多字节中文打碎，必须先还原字节再按 UTF-8 解码
      const json = new TextDecoder().decode(Uint8Array.from(result.content, (c) => c.charCodeAt(0)))
      const parsed = JSON.parse(json) as Project
      if (parsed.version !== 1 || !Array.isArray(parsed.tracks)) {
        throw new Error('不是有效的剪辑项目文件')
      }
      pool.pauseAll()
      project.value = parsed
      currentFile.value = path
      selectedClipId.value = ''
      playhead.value = 0
      playing.value = false
      dirty.value = false
      theShell().Detail.show(VIDEO_EDITOR_DETAIL_ID)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** 保存：已有路径覆盖写；新项目走系统保存对话框取路径（取消返回 false） */
  async function saveProject(): Promise<boolean> {
    let path = currentFile.value
    if (!path) {
      const picked = await window.mxDesktop?.dialog.saveFile(`${project.value.name}.vedit`)
      if (!picked) return false
      path = picked
    }
    try {
      await daemon.call('fs.write', { path, content: JSON.stringify(project.value) })
      currentFile.value = path
      dirty.value = false
      error.value = ''
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // ── 素材导入 ───────────────────────────────────────────────────────────────

  /** 导入结果：成功名清单 + 失败明细（调用方据此提示并决定是否关闭弹窗） */
  interface ImportOutcome {
    ok: string[]
    failed: Array<{ name: string; reason: string }>
  }

  /** 导入本机媒体路径（探测元数据 + 封面；个别失败不阻塞整批，失败明细随返回值透出） */
  async function importPaths(paths: string[]): Promise<ImportOutcome> {
    const outcome: ImportOutcome = { ok: [], failed: [] }
    if (exporting.value) return outcome
    for (const path of paths) {
      const name = path.split('/').pop() || path
      const kind = kindOfExt(name)
      if (!kind) continue
      // 同路径去重（重复导入同一文件只留一份）
      if (project.value.assets.some((a) => a.path === path)) continue
      try {
        const probed = await probeAsset(path, kind)
        const asset: MediaAsset = { id: uid('ast'), path, name, kind, ...probed }
        project.value.assets.push(asset)
        outcome.ok.push(name)
      } catch (e) {
        outcome.failed.push({ name, reason: e instanceof Error ? e.message : String(e) })
      }
    }
    if (outcome.ok.length > 0) touch()
    return outcome
  }

  /** 按类别取（或建）目标轨：video/audio/image → 对应类别轨；返回轨引用 */
  function trackFor(kind: 'video' | 'audio' | 'text'): Track {
    const wantKind: TrackKind = kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : 'video'
    const hit = project.value.tracks.find((t) => t.kind === wantKind)
    if (hit) return hit
    const created: Track = {
      id: uid('trk'),
      kind: wantKind,
      name: wantKind === 'video' ? `画面 ${project.value.tracks.filter((t) => t.kind === 'video').length + 1}` : wantKind === 'audio' ? `声音 ${project.value.tracks.filter((t) => t.kind === 'audio').length + 1}` : `文字 ${project.value.tracks.filter((t) => t.kind === 'text').length + 1}`,
      muted: false,
      hidden: false,
      clips: [],
    }
    project.value.tracks.push(created)
    return created
  }

  /** 轨末端时刻（追加位基准） */
  function trackEnd(track: Track): number {
    return track.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0)
  }

  /** 素材添加为片段：追加到对应轨末端（视频 / 图片 → 画面轨，音频 → 声音轨） */
  function addMediaClip(assetId: string): void {
    if (exporting.value) return
    const asset = resolveAsset(assetId)
    if (!asset) return
    const track = trackFor(asset.kind === 'audio' ? 'audio' : 'video')
    const clip: MediaClip = {
      type: 'media',
      id: uid('clp'),
      assetId: asset.id,
      start: trackEnd(track),
      // 图片默认摆 4 秒；视频 / 音频取素材全长
      duration: asset.kind === 'image' ? 4 : asset.duration,
      inPoint: 0,
      speed: 1,
      volume: asset.kind === 'audio' ? 1 : 0.8,
      opacity: 1,
      filter: neutralFilter(),
      transitionIn: { type: 'none', duration: 0.5 },
    }
    track.clips.push(clip)
    selectedClipId.value = clip.id
    touch()
  }

  /** 添加文字片段：放到播放头处（与现有片段重叠则顺延到轨尾） */
  function addTextClip(): void {
    if (exporting.value) return
    const track = trackFor('text')
    let start = playhead.value
    if (track.clips.some((c) => start < c.start + c.duration && start + 3 > c.start)) {
      start = trackEnd(track)
    }
    const clip: TextClip = {
      type: 'text',
      id: uid('clp'),
      start,
      duration: 3,
      text: '双击右侧属性修改文字',
      fontSize: 64,
      color: '#ffffff',
      strokeColor: '#000000',
      x: 0.5,
      y: 0.5,
      transitionIn: { type: 'fade', duration: 0.4 },
    }
    track.clips.push(clip)
    selectedClipId.value = clip.id
    touch()
  }

  /** 添加贴纸片段（emoji） */
  function addStickerClip(emoji: string): void {
    if (exporting.value) return
    const track = trackFor('text')
    let start = playhead.value
    if (track.clips.some((c) => start < c.start + c.duration && start + 3 > c.start)) {
      start = trackEnd(track)
    }
    const clip: StickerClip = {
      type: 'sticker',
      id: uid('clp'),
      start,
      duration: 3,
      emoji,
      size: 120,
      x: 0.5,
      y: 0.4,
      transitionIn: { type: 'none', duration: 0.4 },
    }
    track.clips.push(clip)
    selectedClipId.value = clip.id
    touch()
  }

  // ── 片段编辑 ───────────────────────────────────────────────────────────────

  /** 同轨时间占用区间（除指定片段外） */
  function otherRanges(track: Track, excludeId: string): Array<{ a: number; b: number }> {
    return track.clips.filter((c) => c.id !== excludeId).map((c) => ({ a: c.start, b: c.start + c.duration }))
  }

  /** 区间碰撞检测（半开区间相交） */
  function hits(ranges: Array<{ a: number; b: number }>, start: number, end: number): boolean {
    return ranges.some((r) => start < r.b && end > r.a)
  }

  /**
   * 移动片段到同轨新起点：吸附（对齐其他片段边缘 / 播放头 / 原点，8px 阈值）+
   * 碰撞拒绝（重叠则维持原位返回 false）。
   */
  function moveClip(clipId: string, trackId: string, wantStart: number): boolean {
    if (exporting.value) return false
    const hit = locateClip(clipId)
    if (!hit || hit.track.id !== trackId) return false
    const { track, clip } = hit
    const threshold = 8 / pxPerSec.value
    const targets = [0, playhead.value]
    for (const other of track.clips) {
      if (other.id === clipId) continue
      targets.push(other.start, other.start + other.duration)
    }
    let start = Math.max(0, wantStart)
    // 双向吸附：取距离最近且在阈值内的目标（左缘未命中再试右缘）
    let bestDelta = threshold
    for (const target of targets) {
      for (const edge of [start, start + clip.duration]) {
        const delta = Math.abs(target - edge)
        if (delta < bestDelta) {
          start += target - edge
          bestDelta = delta
        }
      }
    }
    start = Math.max(0, start)
    if (hits(otherRanges(track, clipId), start, start + clip.duration)) return false
    if (Math.abs(start - clip.start) < 1e-6) return true
    clip.start = start
    touch()
    return true
  }

  /** 裁剪片段边界（edge 'in' 左缘 / 'out' 右缘；wantTime 为轨上时刻） */
  function trimClip(clipId: string, edge: 'in' | 'out', wantTime: number): boolean {
    if (exporting.value) return false
    const hit = locateClip(clipId)
    if (!hit || hit.clip.type !== 'media') return false
    const { track, clip } = hit
    const ranges = otherRanges(track, clipId)
    const minDuration = 0.1
    if (edge === 'in') {
      // 左缘：新 start 不得越过右缘 - 最短时长，且不得撞前邻
      const newStart = Math.min(Math.max(0, wantTime), clip.start + clip.duration - minDuration)
      if (hits(ranges, newStart, newStart + clip.duration)) return false
      const deltaTrack = newStart - clip.start
      const deltaMedia = deltaTrack * clip.speed
      // 收进不越素材入点
      if (clip.inPoint + deltaMedia < 0) return false
      clip.inPoint += deltaMedia
      clip.duration -= deltaTrack
      clip.start = newStart
    } else {
      const newEnd = Math.max(wantTime, clip.start + minDuration)
      if (hits(ranges, clip.start, newEnd)) return false
      const deltaTrack = newEnd - (clip.start + clip.duration)
      const deltaMedia = deltaTrack * clip.speed
      // 拉出不得越过素材出点（有素材全长时才约束；图片不约束）
      const asset = resolveAsset((clip as MediaClip).assetId)
      if (asset && asset.kind !== 'image') {
        if ((clip as MediaClip).inPoint + clip.duration * clip.speed + deltaMedia > asset.duration) {
          return false
        }
      }
      clip.duration += deltaTrack
    }
    touch()
    return true
  }

  /** 播放头分割选中片段（媒体片段按素材位置切两段，文字 / 贴纸按时长切） */
  function splitAtPlayhead(): void {
    if (exporting.value) return
    const hit = selectedClipId.value ? locateClip(selectedClipId.value) : null
    if (!hit) return
    const { track, clip } = hit
    const t = playhead.value
    if (t <= clip.start + 0.05 || t >= clip.start + clip.duration - 0.05) return
    const leftDur = t - clip.start
    // 深拷贝走 JSON（片段数据全部 JSON-safe；structuredClone 无法克隆 reactive proxy）
    let tail: Clip
    if (clip.type === 'media') {
      const splitInPoint = clip.inPoint + leftDur * clip.speed
      tail = { ...JSON.parse(JSON.stringify(clip)), id: uid('clp'), start: t, duration: clip.duration - leftDur, inPoint: splitInPoint }
      clip.duration = leftDur
    } else {
      tail = { ...JSON.parse(JSON.stringify(clip)), id: uid('clp'), start: t, duration: clip.duration - leftDur } as Clip
      clip.duration = leftDur
    }
    track.clips.push(tail)
    touch()
  }

  /** 删除片段（选中态一并清） */
  function deleteClip(clipId: string): void {
    if (exporting.value) return
    for (const track of project.value.tracks) {
      const index = track.clips.findIndex((c) => c.id === clipId)
      if (index >= 0) {
        track.clips.splice(index, 1)
        if (selectedClipId.value === clipId) selectedClipId.value = ''
        touch()
        return
      }
    }
  }

  /** 复制片段：原位后贴（若被占用则放弃不贴） */
  function duplicateClip(clipId: string): void {
    if (exporting.value) return
    const hit = locateClip(clipId)
    if (!hit) return
    const { track, clip } = hit
    const end = clip.start + clip.duration
    if (hits(otherRanges(track, clipId), end, end + clip.duration)) return
    // JSON 深拷贝（同分割：structuredClone 无法克隆 reactive proxy）
    const copy = { ...JSON.parse(JSON.stringify(clip)), id: uid('clp'), start: end } as Clip
    track.clips.push(copy)
    selectedClipId.value = copy.id
    touch()
  }

  /** 轨道静音 / 隐藏切换 */
  function toggleTrackFlag(trackId: string, flag: 'muted' | 'hidden'): void {
    if (exporting.value) return
    const track = project.value.tracks.find((t) => t.id === trackId)
    if (!track) return
    if (flag === 'muted') track.muted = !track.muted
    else track.hidden = !track.hidden
    touch()
  }

  // ── 播放与同步 ─────────────────────────────────────────────────────────────

  /** dissolve 交叉期的前段源片段（紧邻本片段 + 播放头在交叉窗口内；无则 null） */
  function dissolveSourceFor(track: Track, clip: MediaClip, t: number): MediaClip | null {
    const trans = clip.transitionIn
    if (trans.type !== 'dissolve' || trans.duration <= 0) return null
    if (t < clip.start || t >= clip.start + trans.duration) return null
    let best: MediaClip | null = null
    for (const other of track.clips) {
      if (other.type !== 'media' || other.id === clip.id) continue
      // 紧邻判定用 1e-6 容差（与 render.ts previousClip 口径一致；吸附产生的浮点尾差可忽略）
      if (Math.abs(other.start + other.duration - clip.start) > 1e-6) continue
      if (!best || other.start + other.duration > best.start + best.duration) best = other
    }
    return best
  }

  /** 全时间轴同步：把播放头状态施加到所有媒体元素（预览 / 导出共用） */
  function syncAll(t: number, isPlaying: boolean): void {
    const shadowKeys = new Set<string>()
    const activeAssets = new Set<string>()
    const idleAssets: MediaAsset[] = []
    for (const track of project.value.tracks) {
      if (track.kind === 'text') continue
      for (const clip of track.clips) {
        if (clip.type !== 'media') continue
        const asset = resolveAsset(clip.assetId)
        if (!asset) continue
        // dissolve 交叉期：前段另起影子元素供渲染取帧（同素材时主元素让位给后段）
        const prev = dissolveSourceFor(track, clip, t)
        if (prev) {
          const prevAsset = resolveAsset(prev.assetId)
          if (prevAsset) {
            pool.syncShadow(prev, prevAsset, t, isPlaying)
            shadowKeys.add(prev.id)
          }
        }
        const inWindow = pool.syncClip(clip, asset, t, isPlaying, track.muted ? 0 : clip.volume)
        if (inWindow) activeAssets.add(asset.id)
        else idleAssets.push(asset)
      }
    }
    // 窗外元素统一裁决：同素材仍有窗内片段时元素让给它，否则暂停防出窗漏音
    for (const asset of idleAssets) {
      if (!activeAssets.has(asset.id)) pool.pauseElement(asset)
    }
    pool.pruneShadows(shadowKeys)
  }

  /** 变速（剪映语义）：采样区间 [inPoint, outPoint] 不变，时间线时长 = 区间 / 新速度 */
  function setClipSpeed(clipId: string, speed: number): void {
    if (exporting.value) return
    const hit = locateClip(clipId)
    if (!hit || hit.clip.type !== 'media') return
    const clip = hit.clip
    const s = Math.min(4, Math.max(0.25, speed))
    const asset = resolveAsset(clip.assetId)
    let outPoint = mediaOutPoint(clip)
    // 存量数据出点越素材末端时先收进末端（图片无素材时长约束）
    if (asset && asset.kind !== 'image' && outPoint > asset.duration) {
      outPoint = Math.max(clip.inPoint, asset.duration)
    }
    clip.duration = (outPoint - clip.inPoint) / s
    touch()
  }

  /** 播放循环（store 自持 rAF） */
  let rafId = 0
  let lastWall = 0
  function loop(wall: number): void {
    if (!playing.value) return
    const dt = Math.min(0.25, (wall - lastWall) / 1000)
    lastWall = wall
    const total = duration.value
    playhead.value = Math.min(playhead.value + dt, total)
    syncAll(playhead.value, true)
    if (playhead.value >= total) {
      playing.value = false
      syncAll(playhead.value, false)
      return
    }
    rafId = requestAnimationFrame(loop)
  }

  /** 播放 / 暂停切换 */
  function togglePlay(): void {
    if (exporting.value) return
    if (playing.value) {
      playing.value = false
      cancelAnimationFrame(rafId)
      syncAll(playhead.value, false)
      return
    }
    if (duration.value <= 0) return
    if (playhead.value >= duration.value - 1e-6) playhead.value = 0
    playing.value = true
    lastWall = performance.now()
    rafId = requestAnimationFrame(loop)
  }

  /** 定位播放头（拖动 / 点击刻度；暂停态同步取帧） */
  function seek(t: number): void {
    if (exporting.value) return
    playhead.value = Math.max(0, Math.min(t, duration.value))
    syncAll(playhead.value, playing.value)
  }

  // ── 导出 ───────────────────────────────────────────────────────────────────

  /** 导出 webm：实时渲染录制 → 系统对话框选路径 → fs.write_base64 落盘 */
  async function exportVideo(): Promise<boolean> {
    if (exporting.value) return false
    exporting.value = true
    exportProgress.value = 0
    exportMessage.value = ''
    exportAbort = { aborted: false }
    try {
      const wasPlaying = playing.value
      playing.value = false
      cancelAnimationFrame(rafId)
      playhead.value = 0
      // 渲染走 JSON 快照：导出全程读冻结数据，与活项目状态彻底解耦（编辑入口
      // 已由 exporting 守卫 + UI 禁用双保险拦截）；素材解析读活 assets（导出中
      // 导入被禁，不会变化）
      const snapshot = JSON.parse(JSON.stringify(project.value)) as Project
      const result = await runExport({
        rc: { project: snapshot, pool, resolve: resolveAsset },
        pool,
        sync: (t, p) => syncAll(t, p),
        onProgress: (p) => {
          exportProgress.value = p
        },
        signal: exportAbort,
      })
      const picked = await window.mxDesktop?.dialog.saveFile(`${project.value.name}.webm`)
      if (!picked) {
        exportMessage.value = '导出已取消（未选择保存位置）'
        return false
      }
      await daemon.call('fs.write_base64', { path: picked, content: result.base64 })
      exportMessage.value = ''
      if (wasPlaying) togglePlay()
      return true
    } catch (e) {
      exportMessage.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      exporting.value = false
      exportProgress.value = 0
    }
  }

  /** 取消导出（录制循环下一帧感知后收口） */
  function abortExport(): void {
    exportAbort.aborted = true
  }

  /** 插件停用清理（index.ts cleanup 调） */
  function dispose(): void {
    playing.value = false
    cancelAnimationFrame(rafId)
    pool.dispose()
  }

  return {
    pool,
    project,
    currentFile,
    dirty,
    loading,
    error,
    selectedClipId,
    pxPerSec,
    playhead,
    playing,
    exporting,
    exportProgress,
    exportMessage,
    duration,
    resolveAsset,
    locateClip,
    touch,
    create,
    open,
    saveProject,
    importPaths,
    addMediaClip,
    addTextClip,
    addStickerClip,
    moveClip,
    trimClip,
    setClipSpeed,
    splitAtPlayhead,
    deleteClip,
    duplicateClip,
    toggleTrackFlag,
    syncAll,
    togglePlay,
    seek,
    exportVideo,
    abortExport,
    dispose,
  }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type VideoEditorStore = ReturnType<typeof useVideoEditorStore>

export interface VideoEditorService {
  readonly store: VideoEditorStore
}

export function createVideoEditorService(): VideoEditorService {
  return {
    get store() {
      return useVideoEditorStore()
    },
  }
}
