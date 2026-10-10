/**
 * video-editor 插件：视频剪辑工作台（Detail tab 席位，order 107 紧随画板）。
 * 多轨时间线（画面 / 声音 / 文字）+ 素材库 + 属性检查器 + 实时预览，导出
 * webm（MediaRecorder 实时渲染录制）。素材经 mx-file 流协议取帧，项目文件
 * .vedit（JSON）走文件类型接管。services 提供 video-editor.store 延迟外壳；
 * Toolbar 尾段提供「新建剪辑项目」入口；DetailToolbar 提供保存与导出。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import DetailPanel from './DetailPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import DetailActions from './DetailActions.vue'
import {
  bindVideoEditorShell,
  createVideoEditorService,
  useVideoEditorStore,
  VIDEO_EDITOR_DETAIL_ID,
} from './store'

export const videoEditorPlugin: VuePlugin = (ctx) => {
  // 装配期捕获壳本体（store 顶部零 inject 依赖的关键）
  bindVideoEditorShell(ctx)

  // Detail：剪辑工作台 tab（order 107，预置插件保留段 1–1000；openMax 拉出即满宽）
  ctx.Detail.add({
    id: VIDEO_EDITOR_DETAIL_ID,
    order: 107,
    title: '剪辑',
    icon: 'lucide:clapperboard',
    component: DetailPanel,
    openMax: true,
  })

  // Toolbar 尾段：新建剪辑项目入口
  ctx.Toolbar.add({ id: 'video-editor-toolbar-new', slot: 'trailing', order: 103, component: ToolbarTrailing })

  // DetailToolbar（owner 归属本条目）：保存 + 导出
  ctx.Detail.addToolbar({ id: 'video-editor-detail-actions', owner: VIDEO_EDITOR_DETAIL_ID, component: DetailActions })

  // services：store 延迟外壳（装配期 Pinia 未安装，禁止此时创建 store）
  ctx.services.provide('video-editor.store', createVideoEditorService())

  // 文件类型接管：vedit → 本插件（打开路由动态注册表）
  const unregisterFileTypes = ctx.fileTypes.register(['vedit'], 'video-editor.store')

  // 停用清理：席位移除 + 文件类型接管摘除 + 播放循环与媒体元素池释放
  return () => {
    unregisterFileTypes()
    ctx.Toolbar.remove('video-editor-toolbar-new')
    ctx.Detail.removeToolbar('video-editor-detail-actions')
    try {
      useVideoEditorStore().dispose()
    } catch {
      // store 从未实例化（插件停用前未被使用）时无需清理
    }
  }
}
