/**
 * 应用自动更新（electron-updater + GitHub Releases 发布源，定稿 2026-10-02）：
 * 发现（启动 30s 首查 + 4h 轮询）→ 后台自动下载（进度推送渲染层）→ 下载完成提示安装
 * （渲染层纯图标出现 + 确认后 quitAndInstall 立即重启安装）→ autoInstallOnAppQuit 退出兜底。
 * 发布源配置在 electron-builder.yml publish 段（打包时生成 app-update.yml，运行时自动读取）。
 *
 * 禁用条件（两类构建 Gatekeeper 会拦未公证更新，自动更新必须关闭）：
 * - dev 模式（!app.isPackaged）：无更新源，只提供状态查询；
 * - ad-hoc 未公证构建：pack.mjs 在 macOS 公证凭据缺失时注入 mxAdhoc 标记进 package.json，
 *   此处按标记禁用（定时检查不启动、手动检查返回不支持），仅 quit 兜底路径同样禁用。
 *
 * IPC 面（仅允许窗口内发起，语义同 native-theme 桥）：
 * - mx:updater-state  手动拉取状态快照（含 enabled/currentVersion/检查结果）
 * - mx:updater-check  手动检查更新（enabled=false 时返回 { ok:false, reason }）
 * - mx:updater-install 下载完成后确认安装（quitAndInstall，quitting 语义由 main.ts before-quit 承接）
 * - mx:updater-event  主进程 → 渲染层状态推送（checking / downloading / ready / error）
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'

/** electron-updater 以动态 require 引入：依赖较重，dev 下未被禁用前不加载，
 * 同时避免 tsc 的类型侧对运行时包的强绑定（包由 electron/package.json dependencies 提供） */
type ElectronUpdaterModule = { autoUpdater: AppUpdater }

/** 推送渲染层的更新状态（渲染层据此驱动纯图标的出现与进度态） */
export interface UpdaterSnapshot {
  /** 自动更新能力是否启用（dev / ad-hoc 未公证构建 = false） */
  enabled: boolean
  /** 当前应用版本 */
  currentVersion: string
  /** 事件机状态：idle 无事 / checking 检查中 / downloading 下载中 / ready 待安装 */
  status: 'idle' | 'checking' | 'downloading' | 'ready'
  /** 发现的更新版本（update-available 起有值） */
  availableVersion: string | null
  /** 下载进度 0-100（downloading 态） */
  percent: number | null
}

/** 首查延迟（ms）：启动 30s 后，避开启动竞速窗口 */
const FIRST_CHECK_DELAY_MS = 30 * 1000
/** 轮询间隔（ms）：4 小时 */
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000

let updaterModule: ElectronUpdaterModule | null = null
let pollTimer: NodeJS.Timeout | null = null
const snapshot: UpdaterSnapshot = {
  enabled: false,
  currentVersion: app.getVersion(),
  status: 'idle',
  availableVersion: null,
  percent: null,
}

/** 读取 pack.mjs 注入的 mxAdhoc 标记（asar 根 package.json 的构建期字段） */
function isAdhocBuild(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest = require(path.join(app.getAppPath(), 'package.json')) as { mxAdhoc?: boolean }
    return manifest.mxAdhoc === true
  } catch {
    return false
  }
}

/** 广播状态到全部窗口（向导窗未来同样消费，遍历发送不做单窗假设） */
function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mx:updater-event', { ...snapshot })
  }
}

function setStatus(patch: Partial<UpdaterSnapshot>): void {
  Object.assign(snapshot, patch)
  broadcast()
}

function handleAutoUpdater(autoUpdater: AppUpdater): void {
  // 兜底定稿：用户未响应「新版已就绪」提示时，退出安装
  autoUpdater.autoInstallOnAppQuit = true
  // 发现即后台自动下载（不打断当前工作），完成后再提示安装
  autoUpdater.autoDownload = true

  autoUpdater.on('checking-for-update', () => setStatus({ status: 'checking', percent: null }))
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    setStatus({ status: snapshot.status === 'downloading' ? 'downloading' : 'checking', availableVersion: info.version }),
  )
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    setStatus({ status: 'downloading', percent: progress.percent }),
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    setStatus({ status: 'ready', percent: 100, availableVersion: info.version }),
  )
  autoUpdater.on('error', (error: Error) => {
    // 检查/下载失败回 idle 等下轮轮询（后台静默重试），错误仅落日志
    console.error('自动更新流程出错（等待下轮检查）：', error)
    setStatus({ status: 'idle', percent: null })
  })
}

/** 启用自动更新的构建才允许调用（enabled 门在 enableUpdater 内判定） */
function scheduleChecks(autoUpdater: AppUpdater): void {
  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error('检查更新失败（等待下轮）：', error)
    })
  }
  setTimeout(check, FIRST_CHECK_DELAY_MS)
  pollTimer = setInterval(check, POLL_INTERVAL_MS)
  // 定时器不阻止进程退出（app.quit 时无需等待下一轮）
  pollTimer.unref()
}

/** 注册更新机制：enabled 构建接生命周期与 IPC；disabled 构建仅注册只读 IPC。
 * 在 app ready 后调用一次 */
export function registerUpdaterBridge(): void {
  snapshot.currentVersion = app.getVersion()
  const disabled = !app.isPackaged || isAdhocBuild()

  ipcMain.handle('mx:updater-state', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    return { ...snapshot }
  })

  ipcMain.handle('mx:updater-check', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return { ok: false, reason: '非法来源' }
    if (disabled) return { ok: false, reason: '当前构建未启用自动更新' }
    if (snapshot.status === 'ready') return { ok: true }
    void updaterModule?.autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error('手动检查更新失败：', error)
    })
    return { ok: true }
  })

  ipcMain.handle('mx:updater-install', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false
    if (disabled || snapshot.status !== 'ready') return false
    // quitAndInstall 触发 quit → main.ts before-quit 置 quitting，窗口 close 拦截自然放行
    updaterModule?.autoUpdater.quitAndInstall(false, true)
    return true
  })

  if (disabled) return

  // 延迟加载重依赖：确认启用后才引入 electron-updater
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  updaterModule = require('electron-updater') as ElectronUpdaterModule
  handleAutoUpdater(updaterModule.autoUpdater)
  scheduleChecks(updaterModule.autoUpdater)
}

/** 进程退出清理（当前 app 生命周期无 dispose 需求，防御性提供） */
export function disposeUpdater(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
