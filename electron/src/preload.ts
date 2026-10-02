/**
 * 平台标记：在文档根部打 data-platform，CSS 据此启用 macOS 分支
 * （透明背景 + 侧栏半透明染色，让窗口 vibrancy 透出）。
 * 对齐 DSH 的 preload 行为；立即设置 + DOMContentLoaded 兜底（防文档未就绪）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { InstallerStatus } from './daemon-installer'

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

/** 更新状态快照（与主进程 UpdaterSnapshot 同构，见 updater.ts） */
interface UpdaterSnapshot {
  enabled: boolean
  currentVersion: string
  status: 'idle' | 'checking' | 'downloading' | 'ready'
  availableVersion: string | null
  percent: number | null
}

/** 手动检查回执：ok=false 时 reason 为中文原因文案 */
interface UpdaterCheckResult {
  ok: boolean
  reason?: string
}

/** 主题偏好发布通道 + 设置持久化桥 + 在线插件安装桥 + 导航兜底回发
 * （语义校验在渲染侧加载前统一执行，见 plugins.ts 头注） */
contextBridge.exposeInMainWorld('mxDesktop', {
  setNativeThemeSource: (mode: string) => ipcRenderer.invoke('mx:native-theme-set', mode),
  /** 主进程导航拦截回发的外部 web 链接（mx:open-url）；返回退订函数 */
  onOpenUrl: (listener: (url: string) => void): (() => void) => {
    const wrapped = (_event: unknown, url: string): void => listener(url)
    ipcRenderer.on('mx:open-url', wrapped)
    return () => ipcRenderer.removeListener('mx:open-url', wrapped)
  },
  /** 系统浏览器打开链接（mx:open-external，主进程侧仅放行 http/https）；拒绝返回 false */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('mx:open-external', url),
  /** 系统默认程序打开本地文件（mx:open-path）；成功返回空串，失败返回错误描述 */
  openPath: (path: string): Promise<string> => ipcRenderer.invoke('mx:open-path', path),
  preferences: {
    getAll: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('mx:preferences-get'),
    set: (key: string, value: unknown): Promise<boolean> => ipcRenderer.invoke('mx:preferences-set', key, value),
  },
  dialog: {
    saveFile: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('mx:dialog-save-file', defaultName),
    openMindpkg: (): Promise<string | null> => ipcRenderer.invoke('mx:dialog-open-mindpkg'),
  },
  terminal: {
    create: (cwd: string, cols: number, rows: number): Promise<string | null> =>
      ipcRenderer.invoke('mx:terminal-create', cwd, cols, rows),
    write: (id: string, data: string): Promise<boolean> => ipcRenderer.invoke('mx:terminal-write', id, data),
    resize: (id: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke('mx:terminal-resize', id, cols, rows),
    kill: (id: string): Promise<boolean> => ipcRenderer.invoke('mx:terminal-kill', id),
    onData: (listener: (payload: { id: string; data: string }) => void): (() => void) => {
      const wrapped = (_event: unknown, payload: { id: string; data: string }): void => listener(payload)
      ipcRenderer.on('mx:terminal-data', wrapped)
      return () => ipcRenderer.removeListener('mx:terminal-data', wrapped)
    },
    onExit: (listener: (payload: { id: string }) => void): (() => void) => {
      const wrapped = (_event: unknown, payload: { id: string }): void => listener(payload)
      ipcRenderer.on('mx:terminal-exit', wrapped)
      return () => ipcRenderer.removeListener('mx:terminal-exit', wrapped)
    },
  },
  updater: {
    /** 拉取状态快照（构造渲染层更新图标时先拉一次，后续靠事件推送） */
    getState: (): Promise<UpdaterSnapshot | null> => ipcRenderer.invoke('mx:updater-state'),
    /** 手动检查更新；disabled 构建返回 { ok:false, reason } */
    checkNow: (): Promise<UpdaterCheckResult> => ipcRenderer.invoke('mx:updater-check'),
    /** 确认安装已下载的更新（quitAndInstall 立即重启安装；仅 ready 态有效） */
    install: (): Promise<boolean> => ipcRenderer.invoke('mx:updater-install'),
    /** 主进程状态推送订阅（checking/downloading/ready 变化时触发）；返回退订函数 */
    onEvent: (listener: (snapshot: UpdaterSnapshot) => void): (() => void) => {
      const wrapped = (_event: unknown, snapshot: UpdaterSnapshot): void => listener(snapshot)
      ipcRenderer.on('mx:updater-event', wrapped)
      return () => ipcRenderer.removeListener('mx:updater-event', wrapped)
    },
  },
  wizard: {
    /** 打开首启向导窗（设置页重入入口；主进程幂等——已有向导窗则唤出） */
    open: (): Promise<boolean> => ipcRenderer.invoke('mx:wizard-open'),
    /** 向导关闭通知订阅（连接运行时据此重读配置重连）；返回退订函数 */
    onFinished: (listener: () => void): (() => void) => {
      const wrapped = (): void => listener()
      ipcRenderer.on('mx:wizard-finished', wrapped)
      return () => ipcRenderer.removeListener('mx:wizard-finished', wrapped)
    },
  },
  /** 首启向导探测通道族（仅向导窗存在期间在主进程注册；主窗侧调用会得到无 handler 错误） */
  probe: {
    run: (): Promise<unknown> => ipcRenderer.invoke('mx-wizard-probe:run'),
    verifyCredential: (key: string): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('mx-wizard-probe:verify-credential', key),
    takeCredential: (key: string): Promise<string | null> =>
      ipcRenderer.invoke('mx-wizard-probe:take-credential', key),
  },
  /** 智能主机本机安装服务（常驻注册；向导「本机安装」步消费） */
  installer: {
    /** 拉取安装状态快照（进安装步先拉一次，后续靠事件推送） */
    getStatus: (): Promise<InstallerStatus | null> => ipcRenderer.invoke('mx-daemon-install:status'),
    /** 启动安装（幂等：并发调用合并为一次执行） */
    start: (): Promise<InstallerStatus | null> => ipcRenderer.invoke('mx-daemon-install:start'),
    /** 读取 daemon 错误日志尾部（200 行/256KB 截断） */
    getLog: (): Promise<{ path: string; content: string }> => ipcRenderer.invoke('mx-daemon-install:log'),
    /** 安装状态推送订阅（各阶段迁移时触发）；返回退订函数 */
    onEvent: (listener: (status: InstallerStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, status: InstallerStatus): void => listener(status)
      ipcRenderer.on('mx-daemon-install:event', wrapped)
      return () => ipcRenderer.removeListener('mx-daemon-install:event', wrapped)
    },
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
