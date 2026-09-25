/**
 * Electron 窗口壳：仅负责窗口创建，不处理业务逻辑（渲染进程直连服务）。
 *
 * macOS 毛玻璃机制（对齐 DSH apps/desktop/src/main.ts 的主窗口四件套）：
 * `vibrancy: 'sidebar'` 让 macOS 窗口合成器在原生层做侧栏材质模糊，
 * `visualEffectState: 'active'` 保证失焦时材质稳定不冲淡，
 * 透明 `backgroundColor` + hiddenInset 标题栏配合；
 * web 侧由此只需"让开"：页面背景透明（tokens.css darwin 分支），
 * 侧栏只铺半透明染色（SidebarPane darwin 分支），原生 vibrancy 即可透出。
 */
import { app, BrowserWindow, ipcMain, nativeTheme, Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'
import { registerPluginBridge, registerPluginProtocol } from './plugins'

/** 开发模式连接 Vite 服务（MX_DEV_URL 可覆盖）；产物模式加载 app 构建目录 */
const DEV_URL = 'http://localhost:5273'

/** 退出标记：关窗默认拦截为隐藏（程序驻留托盘），
 * 真正退出仅走托盘菜单"退出"或 Cmd+Q（before-quit 置位后放行关闭） */
let quitting = false

/** nativeTheme.themeSource 合法取值（渲染层"自动"档映射为 system 后发布） */
const THEME_SOURCES: ReadonlySet<string> = new Set(['light', 'dark', 'system'])

/** 主题偏好桥：校验取值与发送者（仅允许窗口内发起）后写入 nativeTheme.themeSource，
 * 让 vibrancy 材质跟随应用主题而非系统外观（对齐 DSH native-theme-set 机制） */
function registerNativeThemeBridge(): void {
  ipcMain.handle('mx:native-theme-set', (event, value: unknown) => {
    if (typeof value !== 'string' || !THEME_SOURCES.has(value)) return false
    if (!BrowserWindow.fromWebContents(event.sender)) return false
    nativeTheme.themeSource = value as 'light' | 'dark' | 'system'
    return true
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'MindX Work',
    // macOS 专属：窗口材质四件套（其余平台走普通窗口）
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 18 },
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // 关窗拦截为隐藏（托盘驻留语义）：窗口销毁会丢失页面状态，且驻留图标
  // 需要一个"显示主界面"的宿主；真正退出走托盘菜单或 Cmd+Q（quitting 放行）
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      win.hide()
    }
  })

  // 加载优先级：MX_DEV_URL（dev 覆盖）> MX_PROD_DIST（本地指向任意前端产物目录）
  // > 打包产物内的 app/dist（electron-builder 打进 asar 的相对定位）> dev 服务兜底
  if (process.env.MX_DEV_URL) {
    void win.loadURL(process.env.MX_DEV_URL)
  } else if (process.env.MX_PROD_DIST) {
    void win.loadFile(path.join(process.env.MX_PROD_DIST, 'index.html'))
  } else if (app.isPackaged) {
    // 前端产物经 extraResources 装到 <App>.app/Contents/Resources/app-dist（asar 外）
    void win.loadFile(path.join(process.resourcesPath, 'app-dist', 'index.html'))
  } else {
    void win.loadURL(DEV_URL)
  }
}

/** 托盘图标资源定位：dev 取仓库 resources/；打包产物在 Contents/Resources/tray */
function resolveTrayAsset(name: string): string {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '..', '..', 'resources', 'tray')
  return path.join(dir, name)
}

/** 唤出主界面：最小化先还原，隐藏则显示并抢焦点；窗口已销毁时重建 */
function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 创建系统驻留图标（macOS 状态栏 / Windows 通知栏）：
 * macOS 单击即唤出主界面并同时弹出菜单（setContextMenu 会接管 click 事件，
 * 故 darwin 改用编程弹出 popUpContextMenu）；Windows 左键单击唤主界面、右键弹菜单 */
function createTray(): void {
  try {
    // macOS 用模板图（纯黑 + alpha，系统按菜单栏亮暗自动反色）；Windows 用彩色图
    const iconPath = process.platform === 'darwin'
      ? resolveTrayAsset('iconTemplate.png')
      : resolveTrayAsset('icon.png')
    const trayRef = new Tray(nativeImage.createFromPath(iconPath))
    trayRef.setToolTip('MindX Work')
    const menu = Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出 MindX Work',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ])
    if (process.platform === 'darwin') {
      // 单击：先唤主界面再弹菜单（popUpContextMenu 同步跟踪菜单，顺序不可颠倒）
      trayRef.on('click', () => {
        showMainWindow()
        trayRef.popUpContextMenu(menu)
      })
    } else {
      trayRef.setContextMenu(menu)
      trayRef.on('click', showMainWindow)
    }
    console.log('系统驻留图标已创建')
  } catch (error) {
    console.error('创建系统驻留图标失败：', error)
  }
}

app.whenReady().then(() => {
  registerPluginProtocol()
  registerNativeThemeBridge()
  registerPluginBridge()
  createWindow()
  createTray()
  // dock 点击（macOS）/ 任务栏重开（Windows）：有窗口则唤出，无则重建
  app.on('activate', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) showMainWindow()
    else createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
