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

/** 渲染侧插件安装回执（含错误消息，中文） */
interface PluginInstallResult {
  ok: boolean
  message?: string
}

/** 主题偏好发布通道 + 设置持久化桥 + 在线插件安装桥（语义校验在渲染侧加载前统一执行，见 plugins.ts 头注） */
contextBridge.exposeInMainWorld('mxDesktop', {
  setNativeThemeSource: (mode: string) => ipcRenderer.invoke('mx:native-theme-set', mode),
  preferences: {
    getAll: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('mx:preferences-get'),
    set: (key: string, value: unknown): Promise<boolean> => ipcRenderer.invoke('mx:preferences-set', key, value),
  },
  dialog: {
    saveFile: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('mx:dialog-save-file', defaultName),
    openMindpkg: (): Promise<string | null> => ipcRenderer.invoke('mx:dialog-open-mindpkg'),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    installFromFile: (): Promise<PluginInstallResult> => ipcRenderer.invoke('plugins:install-from-file'),
    marketList: (): Promise<unknown> => ipcRenderer.invoke('plugins:market-list'),
    installFromUrl: (url: string, sha256?: string): Promise<PluginInstallResult> =>
      ipcRenderer.invoke('plugins:install-from-url', url, sha256),
    uninstall: (id: string) => ipcRenderer.invoke('plugins:uninstall', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('plugins:set-enabled', id, enabled),
    setActiveVersion: (id: string, version: string) => ipcRenderer.invoke('plugins:set-active-version', id, version),
  },
})
