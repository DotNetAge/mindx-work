/**
 * 平台标记：在文档根部打 data-platform，CSS 据此启用 macOS 分支
 * （透明背景 + 侧栏半透明染色，让窗口 vibrancy 透出）。
 * 对齐 DSH 的 preload 行为；立即设置 + DOMContentLoaded 兜底（防文档未就绪）。
 */
import { contextBridge, ipcRenderer } from 'electron'

const mark = (): void => {
  document.documentElement.dataset.platform = process.platform
}
// preload 同步阶段文档可能尚未创建 html 元素（实测为 null），此时挂到 DOMContentLoaded
if (document.documentElement) {
  mark()
} else {
  window.addEventListener('DOMContentLoaded', mark)
}

/** 主题偏好发布通道：渲染层 → 主进程 nativeTheme.themeSource，
 * 让 vibrancy 材质跟随应用主题（取值合法性由主进程校验） */
contextBridge.exposeInMainWorld('mxDesktop', {
  setNativeThemeSource: (mode: string) => ipcRenderer.invoke('mx:native-theme-set', mode),
})
