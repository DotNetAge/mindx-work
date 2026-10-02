/**
 * 首启向导窗口壳（定稿 2026-10-02）：独立全屏向导窗口，与主界面隔离。
 *
 * 门 = 环境事实派生（deepseek-harness welcome 先例）：「1314 探活失败 + 无远程地址 +
 * 无 WSL 代次注册表 + Docker 不可用」四条全空才弹向导；完成与否不写标记位，
 * skip 后下次启动重新按事实判定，天然幂等可重入。
 * （注：Docker 条件用 docker info 守护进程可达性近似定稿的"无 Docker 容器"，
 * 容器级枚举留第三期本机 daemon 安装时补。）
 *
 * 通道族按需安装：探测 IPC（probe.ts）与向导完成通知通道仅在向导窗存在期间注册，
 * 窗口销毁即卸载，不污染主窗 IPC 面。
 * 完成交接：向导窗销毁 → 向主窗回发 mx:wizard-finished（连接运行时重读配置重连），
 * 并把主窗带回前台，防双窗同显。
 * 重入入口：mx:wizard-open（常驻通道，主窗设置页调用）+ MX_WIZARD=1 环境变量强制弹（dev 调试）。
 */
import { BrowserWindow, app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { probeDaemonAlive, probeDocker, installProbeIpc, uninstallProbeIpc } from './probe'
import { readPreferencesValues } from './preferences'

/** dev 模式连接 Vite 服务（与 main.ts 同值；向导页为 /wizard.html） */
const DEV_URL = 'http://localhost:5273'

/** 连接配置键（与渲染层 runtime.ts 约定一致；权威落盘在 preferences.json） */
const MODE_KEY = 'mindx.daemon.mode'
const REMOTE_URL_KEY = 'mindx.daemon.remoteUrl'

let wizardWindow: BrowserWindow | null = null

/** 门判定：四事实全空 = 首启待初始化（事实派生，无标记位） */
async function shouldShowWizard(): Promise<boolean> {
  const values = readPreferencesValues()
  const hasRemote = values[MODE_KEY] === 'remote' && typeof values[REMOTE_URL_KEY] === 'string' && values[REMOTE_URL_KEY] !== ''
  if (hasRemote) return false
  if (await probeDaemonAlive().catch(() => false)) return false
  const wslRegistry = path.join(homedir(), '.mindx', 'data', 'studio', 'wsl', 'registry.json')
  if (existsSync(wslRegistry)) return false
  // Docker 可达性（第三期补容器级枚举；注释见头注）
  return !(await probeDocker().catch(() => false))
}

/** 创建向导窗：独立全屏窗口（实底、无 vibrancy），通道族随窗口生命周期安装/卸载 */
export function showWizard(): void {
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.show()
    wizardWindow.focus()
    return
  }
  installProbeIpc()

  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'MindX Work 初始化',
    fullscreenable: true,
    autoHideMenuBar: true,
    // 无 titlebar 只留 macOS 红绿灯（内容全幅延伸；拖拽区由向导页顶部提供）
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  wizardWindow = win
  // macOS 独立窗不加 vibrancy（向导是仪式感全屏页，实底渲染）；窗口就绪再显避免白闪
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    wizardWindow = null
    uninstallProbeIpc()
    notifyMainWindowWizardFinished()
  })

  if (process.env.MX_DEV_URL) {
    void win.loadURL(new URL('wizard.html', process.env.MX_DEV_URL).toString())
  } else if (app.isPackaged) {
    // 与主窗同目录（Contents/Resources/app-dist/wizard.html），file:// 同源共享 localStorage
    void win.loadFile(path.join(process.resourcesPath, 'app-dist', 'wizard.html'))
  } else {
    void win.loadURL(`${DEV_URL}/wizard.html`)
  }
}

/** 向导关闭后主窗交接动作（main.ts 注入 showMainWindow：无主窗时重建、有则唤出） */
let wizardFinishedHandler: (() => void) | null = null

/** 向主窗回发向导完成通知（连接运行时据此重读配置重连），并把主窗带回前台；
 * 首启场景主窗尚未创建，交由注入的 handler 重建 */
function notifyMainWindowWizardFinished(): void {
  const main = BrowserWindow.getAllWindows().find((w) => w !== wizardWindow && !w.isDestroyed())
  if (main) {
    main.webContents.send('mx:wizard-finished')
    main.show()
    main.focus()
    return
  }
  wizardFinishedHandler?.()
}

/** main.ts 注册主窗交接动作（showMainWindow） */
export function setWizardFinishedHandler(handler: () => void): void {
  wizardFinishedHandler = handler
}

/** 常驻重入通道（主窗渲染层设置页调用）：打开向导窗 */
export function registerWizardBridge(): void {
  ipcMain.handle('mx:wizard-open', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false
    showWizard()
    return true
  })
}

/** app ready 后的门检查：门命中（或 MX_WIZARD=1 强制）则先弹向导、暂不建主窗；
 * 门未命中则照常启动（main.ts 按 false 结果建主窗） */
export async function maybeShowWizard(): Promise<boolean> {
  if (process.env.MX_WIZARD === '1') {
    showWizard()
    return true
  }
  if (await shouldShowWizard()) {
    showWizard()
    return true
  }
  return false
}
