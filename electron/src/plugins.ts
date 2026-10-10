/**
 * 在线插件（market）安装模块（主进程）—— Electron 层。
 * 纯 Node 存储逻辑在 plugin-store.ts（mw CLI 复用同一份实现，root 由 createPluginStore 注入）。
 * 本模块职责 = mx-plugin 协议、IPC 桥（全部要求窗口内发起，契约 §17 边界校验）、
 * 安装/导出对话框挂父窗口、清单变更 watch 广播（mw CLI 装完 app 即时感知激活）。
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPluginStore, ID_RE, VERSION_RE, MARKET_MAX_ZIP_BYTES } from './plugin-store'
import { unzipSync } from 'fflate'

/** 特权协议注册：必须在 app.ready 之前执行。
 * mx-plugin://<插件id>/<版本>/<文件> —— 渲染进程动态加载插件的统一通道
 * （dev http origin 与产物 file origin 下直接 import file:// 均被 Chromium 拒绝，
 * 自定义标准协议 dev/prod 行为一致）。standard + supportFetchAPI 使动态 import 与 fetch 清单可用。
 * 特权声明统一在 main.ts 一次性注册（Electron 该方法全局只允许调用一次，两处各自调用
 * 会让后一次覆盖前一次——mx-plugin 曾因此静默失联，handler 永不命中，实证见 §7 协议加载）。
 */
export const PLUGIN_SCHEMES: Electron.CustomScheme[] = [
  {
    scheme: 'mx-plugin',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]

const store = createPluginStore(path.join(app.getPath('userData'), 'plugins'))

/** 官方可选件搭载目录：打包发行 = resources/plugins-optional（electron-builder extraResources）；
 * dev（资源目录无搭载时）回退仓库 dist-optional（构建脚本产物，electron/dist 上两级 = 仓库根），便于本地验收 */
function optionalResourcesDir(): string {
  const packed = path.join(process.resourcesPath ?? '', 'plugins-optional')
  if (existsSync(packed)) return packed
  return path.resolve(__dirname, '..', '..', 'dist-optional')
}

function pluginsRoot(): string {
  return store.root()
}

/** 读搭载 .mindpkg 的包内 manifest（插件清单口径：id/name/version/description/author） */
function readOptionalManifest(file: string): { id: string; name: string; version: string; description: string; author?: string } | null {
  const files = unzipSync(new Uint8Array(readFileSync(file)))
  const raw = files['manifest.json']
  if (!raw) return null
  const m = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
  if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.version !== 'string') return null
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    description: typeof m.description === 'string' ? m.description : '',
    ...(typeof m.author === 'string' && m.author ? { author: m.author } : {}),
  }
}

/** 协议文件后缀白名单与 MIME（插件包资源仅限声明性资源与脚本入口） */
const MIME_BY_EXT: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** 协议响应统一补 CORS 头：standard scheme 受同源策略约束，页面 origin（dev http /
 * 产物 file）跨源取 mx-plugin 资源，无 Access-Control-Allow-Origin 即被拒
 * （表现 = 裸 "Failed to fetch"，状态码被 CORS 层吞掉）。插件资源即壳的公共资源
 * （显式安装即信任），全部放行；预检请求直接放行 204 */
function withCors(resp: Response): Response {
  const headers = new Headers(resp.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers })
}

/** mx-plugin 协议处理：host = 插件 id，path = <版本>/<文件>。
 * 机械校验（id/version 格式 + 路径不越界 + 后缀白名单）后回读版本目录内文件 */
export function registerPluginProtocol(): void {
  protocol.handle('mx-plugin', async (request) => {
    if (request.method === 'OPTIONS') {
      const preflight = new Response(null, { status: 204 })
      preflight.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
      return withCors(preflight)
    }
    let resp: Response
    try {
      const url = new URL(request.url)
      const id = url.hostname
      const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean)
      if (segments.length < 2) return withCors(new Response('路径须为 <版本>/<文件>', { status: 400 }))
      const [version, ...fileParts] = segments
      if (!ID_RE.test(id) || !VERSION_RE.test(version)) {
        return withCors(new Response('插件 id 或版本格式非法', { status: 400 }))
      }
      const dir = store.versionDirPath(id, version)
      const target = path.resolve(dir, ...fileParts)
      if (!target.startsWith(dir + path.sep)) return withCors(new Response('路径越界', { status: 403 }))
      const ext = path.extname(target)
      const mime = MIME_BY_EXT[ext]
      if (!mime || !existsSync(target)) return withCors(new Response('文件不存在或类型不允许', { status: 404 }))
      // 必须 await：net.fetch 的 rejection 若裸 return 会穿透 protocol.handle 成为
      // 渲染侧网络错误（主进程无日志，诊断盲区）；await 后失败收敛为 5xx 讲人话回执
      resp = await net.fetch(pathToFileURL(target).href)
    } catch (error) {
      resp = new Response(error instanceof Error ? error.message : String(error), { status: 500 })
    }
    return withCors(resp)
  })
}

/** 广播清单变更到全部窗口：mw CLI 落盘 installed.json 后渲染侧即时重扫激活（自扩展闭环） */
function broadcastInstalledChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('plugins:changed')
  }
}

/** IPC 注册：全部要求窗口内发起（契约 §17 边界校验）；
 * 注册同时启动清单 watch（watch 目录而非文件——installed.json 原子替换走 rename，文件句柄会失效） */
export function registerPluginBridge(): void {
  console.log('插件安装目录：', pluginsRoot())
  ipcMain.handle('plugins:list', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    return store.list()
  })
  // 官方可选件：枚举发行搭载目录中的 .mindpkg（未安装的供插件页「官方可选件」区呈现）
  ipcMain.handle('plugins:optional-list', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    const dir = optionalResourcesDir()
    if (!existsSync(dir)) return []
    const installed = new Set(store.list().map((p) => p.id))
    const out: Array<{ id: string; name: string; version: string; description: string; author?: string; file: string; installed: boolean }> = []
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.mindpkg')) continue
      const file = path.join(dir, entry)
      try {
        const manifest = readOptionalManifest(file)
        if (!manifest) continue
        out.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description || '',
          ...(typeof manifest.author === 'string' && manifest.author ? { author: manifest.author } : {}),
          file: entry,
          installed: installed.has(manifest.id),
        })
      } catch (error) {
        console.error(`可选件 ${entry} 解析失败，已跳过：`, error instanceof Error ? error.message : error)
      }
    }
    return out
  })
  // 官方可选件：从搭载资源释放安装（与市场安装同一管线；origin=core-optional，卸载后可重装）
  ipcMain.handle('plugins:optional-install', (event, file: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof file !== 'string') {
      return { ok: false, message: '拒绝非法调用' }
    }
    // file 仅允许搭载目录内的文件名（防路径穿越取任意盘上文件）
    if (file.includes('/') || file.includes('\\') || file.includes('..') || !file.endsWith('.mindpkg')) {
      return { ok: false, message: '文件名非法' }
    }
    const target = path.join(optionalResourcesDir(), file)
    if (!existsSync(target)) return { ok: false, message: '搭载资源中不存在该可选件' }
    try {
      const buf = readFileSync(target)
      const plugin = store.installZipData(new Uint8Array(buf), undefined, 'core-optional')
      return { ok: true, plugin }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('plugins:install-from-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, message: '拒绝非窗口发起的调用' }
    // 对话框挂父窗口（模态归属正确）；本地包同受大小上限约束（statSync 预检避免整读大文件）
    const picked = await dialog.showOpenDialog(win, {
      title: '选择插件包',
      filters: [{ name: '插件包', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, message: '已取消' }
    try {
      const file = picked.filePaths[0]
      if (statSync(file).size > MARKET_MAX_ZIP_BYTES) {
        return { ok: false, message: '插件包超过大小上限（50MB）' }
      }
      return { ok: true, plugin: store.installZipData(new Uint8Array(readFileSync(file))) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('plugins:install-from-url', async (event, url: unknown, sha256: unknown, publishedAt: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof url !== 'string') {
      return { ok: false, message: '拒绝非法调用' }
    }
    try {
      return {
        ok: true,
        plugin: await store.installFromUrl(
          url,
          typeof sha256 === 'string' ? sha256 : undefined,
          typeof publishedAt === 'number' && Number.isFinite(publishedAt) ? publishedAt : undefined,
        ),
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('plugins:uninstall', (event, id: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string') return false
    return store.uninstall(id)
  })
  ipcMain.handle('plugins:set-enabled', (event, id: unknown, enabled: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || typeof enabled !== 'boolean') return false
    return store.setEnabled(id, enabled)
  })
  ipcMain.handle('plugins:set-active-version', (event, id: unknown, version: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || typeof version !== 'string') return false
    return store.setActiveVersion(id, version)
  })
  ipcMain.handle('plugins:export', async (event, id: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof id !== 'string') return { ok: false, message: '拒绝非法调用' }
    const record = store.list().find((p) => p.id === id)
    if (!record) return { ok: false, message: '插件不存在或已卸载' }
    const picked = await dialog.showSaveDialog(win, {
      title: '导出插件',
      defaultPath: `${id}-${record.version}.zip`,
      filters: [{ name: '插件包', extensions: ['zip'] }],
    })
    if (picked.canceled || !picked.filePath) return { ok: false, message: '已取消' }
    try {
      return { ok: true, path: store.exportToFile(id, picked.filePath) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  // 清单 watch（防抖 300ms）：安装/卸载/启停/切版均以 installed.json 原子替换收尾，
  // rename 触发目录 change 事件；一次性 watcher 收到 rename 后可能失效，异常时重挂
  let debounce: NodeJS.Timeout | null = null
  const startWatcher = (): void => {
    try {
      const watcher = watch(pluginsRoot(), (event, filename) => {
        if (filename !== 'installed.json' && filename !== 'installed.json.tmp') return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          try {
            broadcastInstalledChanged()
          } catch (error) {
            console.error('插件清单变更广播失败：', error instanceof Error ? error.message : error)
          }
        }, 300)
      })
      watcher.on('error', () => startWatcher())
    } catch (error) {
      // 根目录尚不存在等场景：首轮安装会 mkdir，此处静默降级为「CLI 变更后重启生效」
      console.error('插件清单 watch 启动失败（将依赖启动期重扫）：', error instanceof Error ? error.message : error)
    }
  }
  startWatcher()
}
