/**
 * video-viewer 插件 store：视频打开状态（Model）。
 * 数据通道：Electron 主进程 mx-file:// 流式协议（Range 分段流，<video> 拖动进度
 * 即点即放；base64 整读对大文件不可行）。纯 Web 环境无 mx-file 宿主协议，
 * <video> 加载失败由面板错误态呈现。壳引用装配期捕获，store 顶部零 inject 依赖。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { VueAppShell } from '@mindx-work/ui-shell-vue'

/** Detail tab 条目 id（index.ts 注册与命令编排共用） */
export const VIDEO_VIEWER_DETAIL_ID = 'video-viewer-detail'

// ── 壳引用绑定（装配期一次）─────────────────────────────────────────────────

let shellRef: VueAppShell | null = null

/** 插件函数体内绑定 AppShell 本体 */
export function bindVideoViewerShell(shell: VueAppShell): void {
  shellRef = shell
}

/** 运行期取壳 */
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('video-viewer 壳未绑定：插件装配缺失')
  return shellRef
}

// ── store ────────────────────────────────────────────────────────────────────

export const useVideoViewerStore = defineStore('video-viewer-store', () => {
  /** 当前视频绝对路径（空 = 未打开） */
  const currentFile = ref('')
  /** mx-file 流式地址（<video> src） */
  const srcUrl = ref('')

  /** 剥离 grep 命中行传入的 `:行号` 尾巴 */
  function stripLineSuffix(p: string): string {
    return p.replace(/:\d+(-\d+)?$/, '')
  }

  /**
   * 命令 action（契约 §10.3 范式）：打开视频到详情轨道（单例查看，换文件替换）。
   * 路径逐段 encodeURIComponent（encodeURI 不编码 # 等结构字符会破坏 URL）。
   */
  function open(target: string): void {
    const path = stripLineSuffix(target.trim())
    if (!path) return
    currentFile.value = path
    srcUrl.value = `mx-file://local${path.split('/').map(encodeURIComponent).join('/')}`
    theShell().Detail.show(VIDEO_VIEWER_DETAIL_ID)
  }

  return { currentFile, srcUrl, open }
})

// ── 服务外壳（装配期 Pinia 尚未安装，provide 延迟解析响应式本体）────────────

export type VideoViewerStore = ReturnType<typeof useVideoViewerStore>

export interface VideoViewerService {
  readonly store: VideoViewerStore
}

export function createVideoViewerService(): VideoViewerService {
  return {
    get store() {
      return useVideoViewerStore()
    },
  }
}
