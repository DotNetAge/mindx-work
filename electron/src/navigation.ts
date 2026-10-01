/**
 * 窗口导航拦截模块（主进程）：外部网络链接统一进应用内 web-viewer 的全局兜底网。
 * 职责 = setWindowOpenHandler（window.open / a[target=_blank] 触发的新窗口请求，
 * 含 iframe 内）与 will-navigate（无 target 链接点击导致主窗口自身跳走）全拦截；
 * 通过校验的 http/https URL 经 mx:open-url 通道回发渲染层，落点由 web-viewer
 * 插件决定（插件停用时渲染侧无人消费，仅静默不开窗，不炸）。
 * 例外 = 应用自身页面（dev Vite origin / 产物 file://）放行，其余一律不弹系统窗口。
 */
import type { BrowserWindow } from 'electron'
import { ipcMain, shell } from 'electron'

/** 应用自身 origin（与 main.ts 的 dev 加载地址同源判据；MX_DEV_URL 覆盖时同取） */
function selfOrigin(): string {
  const raw = process.env.MX_DEV_URL || 'http://localhost:5273'
  try {
    return new URL(raw).origin
  } catch {
    return 'http://localhost:5273'
  }
}

/** 是否应用自身页面（产物全部为 file:// 资源；dev 为 Vite origin） */
function isSelfPage(url: URL): boolean {
  return url.protocol === 'file:' || url.origin === selfOrigin()
}

/** 是否外部网络链接（仅 http/https 回发路由；mailto: 等其它 scheme 忽略） */
function isWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 主窗口装网（创建后调用一次）：新窗口全拒 + 自身跳转拦截，web 链接回发渲染层 */
export function installNavigationGuard(win: BrowserWindow): void {
  // 新窗口请求（含 iframe 内 target=_blank 上抛）：一律不弹窗，web 链接改路由详情轨道
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) win.webContents.send('mx:open-url', url)
    return { action: 'deny' }
  })
  // 主窗口自身导航（无 target 链接 / location 赋值）：自身页面放行，外链拦截并回发
  win.webContents.on('will-navigate', (event, url) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      event.preventDefault()
      return
    }
    if (isSelfPage(parsed)) return
    event.preventDefault()
    if (isWebUrl(url)) win.webContents.send('mx:open-url', url)
  })
}

/**
 * 系统浏览器打开桥（mx:open-external）：Agent-Driven UI 命令通道的 link_open
 * 执行端。授权登录等场景目标站拒绝 iframe 嵌入（X-Frame-Options），必须落系统
 * 浏览器；仅放行 http/https，与导航网同一套 scheme 纪律。主进程注册一次。
 */
export function registerOpenExternalBridge(): void {
  ipcMain.handle('mx:open-external', (_event, raw: unknown) => {
    if (typeof raw !== 'string' || !isWebUrl(raw)) return false
    void shell.openExternal(raw)
    return true
  })
}

/**
 * 系统默认程序打开文件桥（mx:open-path）：Agent-Driven UI 命令通道 file_open
 * 的兜底执行端——客户端无内置查看器的文件类型（pdf/office/压缩包等）交系统
 * 默认程序。shell.openPath 成功返回空串、失败返回错误描述，语义原样透传。
 */
export function registerOpenPathBridge(): void {
  ipcMain.handle('mx:open-path', (_event, raw: unknown) => {
    if (typeof raw !== 'string' || !raw) return '拒绝打开：路径为空'
    return shell.openPath(raw)
  })
}
