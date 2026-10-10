/**
 * 应用内浏览器子窗口（市场账号登录等需用户交互的授权页专用）：
 * GitHub 授权页拒绝 iframe/web-viewer 内嵌（X-Frame-Options），而系统浏览器
 * 会把用户带离应用——独立 BrowserWindow 顶层导航不受限，是两难之间的正解。
 * 480×680 居中于父窗，轻量无桥（不挂 preload，页面不需要任何宿主能力）；
 * 授权完成页 window.close() 即关窗回客户端。
 */
import { BrowserWindow, ipcMain, shell } from 'electron'

/** 是否外部网络链接（仅 http/https；与 navigation.ts 同一套 scheme 纪律） */
function isWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 打开应用内授权子窗口：同一 URL 已有窗口时唤出复用（防重复登录窗堆积） */
function openInAppWindow(parent: BrowserWindow, url: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.title === '市场账号登录' && !win.isDestroyed()) {
      win.show()
      win.focus()
      return
    }
  }
  const win = new BrowserWindow({
    width: 480,
    height: 680,
    title: '市场账号登录',
    parent,
    modal: false,
    center: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      // 无 preload：授权页是外部网页，不需要宿主桥
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // 子窗口内新窗请求拒绝并转系统浏览器（GitHub 罕见弹窗兜底）
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isWebUrl(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    // 无需清理：窗口随授权页生命周期自灭
  })
  void win.loadURL(url)
}

/**
 * 应用内打开链接桥（mx:open-in-app）：link_open 事件 mode=in_app 的执行端。
 * 发起方为主窗口渲染层，父窗取发送者所属 BrowserWindow（居中定位基准）。
 */
export function registerInAppBridge(): void {
  ipcMain.handle('mx:open-in-app', (event, raw: unknown) => {
    if (typeof raw !== 'string' || !isWebUrl(raw)) return false
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) return false
    openInAppWindow(parent, raw)
    return true
  })
}
