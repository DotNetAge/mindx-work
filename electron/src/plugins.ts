/**
 * 在线插件（market）安装模块（主进程）：机械层。
 * 职责 = zip 包安装（解压/落盘）、版本目录管理（不可变代际 + 激活指针）、安装清单读写、IPC。
 * 语义校验分工（契约 §17 IPC 边界各自防线）：本模块只做防路径穿越的机械校验
 * （id/version 字符格式、entry 存在）；契约全量校验（字段完整性/mxApiVersion）
 * 在渲染侧加载前由 ui-shell 的 manifestIssues 统一执行（唯一家）。
 * 持久化代际纪律：版本目录是不可变代际——更新不删旧版（回滚 = 切激活指针），
 * 仅显式卸载删除；installed.json 只增字段（schemaVersion 单调）。
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'

/** 特权协议注册：必须在 app.ready 之前执行。
 * mx-plugin://<插件id>/<版本>/<文件> —— 渲染进程动态加载插件的统一通道
 * （dev http origin 与产物 file origin 下直接 import file:// 均被 Chromium 拒绝，
 * 自定义标准协议 dev/prod 行为一致）。standard + supportFetchAPI 使动态 import 与 fetch 清单可用 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mx-plugin',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

/** 已安装插件某代际记录（只增字段） */
interface InstalledVersion {
  version: string
  /** 包文件哈希（市场安装时用于与 index.json 期望值比对；本地安装仅记录） */
  sha256: string
  installedAt: number
}

/** 已安装插件记录：id 是身份，versions 是不可变代际列表，activeVersion 是激活指针 */
interface InstalledPlugin {
  id: string
  name: string
  enabled: boolean
  activeVersion: string
  versions: InstalledVersion[]
}

/** 安装清单（userData/plugins/installed.json）；schemaVersion 单调递增，只增字段 */
interface InstalledFile {
  schemaVersion: 1
  plugins: InstalledPlugin[]
}

/** 渲染侧视图：含目录绝对路径（供动态 import 入口） */
export interface InstalledPluginView {
  id: string
  name: string
  version: string
  enabled: boolean
  /** 该插件全部已装版本（新→旧仅按安装时间） */
  versions: string[]
  /** 入口绝对路径（file:// import 用） */
  entryPath: string
  origin: 'market'
}

/** 机械校验正则（与 ui-shell plugin-manifest 的语义校验重复最小必要项：
 * 主进程拿 id/version 拼落盘路径，必须先过格式关防路径穿越） */
const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const VERSION_RE = /^\d+\.\d+\.\d+$/

function pluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

function installedFilePath(): string {
  return path.join(pluginsRoot(), 'installed.json')
}

function readInstalled(): InstalledFile {
  const file = installedFilePath()
  if (!existsSync(file)) return { schemaVersion: 1, plugins: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // 物理损坏恢复：备份现场后按空清单继续运作（用户可重装；代际纪律只约束"未知版本拒绝"，不适用于损坏）
    const backup = `${file}.broken-${Date.now()}`
    try {
      renameSync(file, backup)
      console.error(`安装清单损坏，已备份至 ${backup}`)
    } catch {
      console.error('安装清单损坏且备份失败，按空清单继续')
    }
    return { schemaVersion: 1, plugins: [] }
  }
  const data = parsed as Partial<InstalledFile>
  if (data.schemaVersion !== 1) {
    throw new Error(`安装清单 schemaVersion ${String(data.schemaVersion)} 未知，拒绝读取`)
  }
  if (!Array.isArray(data.plugins)) {
    throw new Error('安装清单形状非法：plugins 不是数组，拒绝读取')
  }
  // 逐条核心字段校验：不合格条目剔除（防止半行损坏记录拖垮全部读取）；
  // 构造字面量返回（对 parsed 对象做属性写入会使类型收窄失效）
  return {
    schemaVersion: data.schemaVersion,
    plugins: data.plugins.filter(
      (p) =>
        typeof p?.id === 'string' &&
        typeof p?.name === 'string' &&
        typeof p?.enabled === 'boolean' &&
        typeof p?.activeVersion === 'string' &&
        Array.isArray(p?.versions),
    ),
  }
}

function writeInstalled(data: InstalledFile): void {
  mkdirSync(pluginsRoot(), { recursive: true })
  // 原子替换：同目录写临时文件后 rename，杜绝中途崩溃留下半行 JSON
  const file = installedFilePath()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

/** 安装目录必须解析后仍位于根内（防符号链接与畸形 id/version 穿越） */
function versionDir(id: string, version: string): string {
  const root = pluginsRoot()
  const dir = path.resolve(root, id, version)
  if (!dir.startsWith(root + path.sep)) throw new Error(`插件路径越界：${id}@${version}`)
  return dir
}

/** 解压 zip 并按 manifest 机械校验；返回 manifest 与包内容 */
function extractZip(zipData: Uint8Array): { manifest: { id: string; name: string; version: string; entry: string }, files: Record<string, Uint8Array> } {
  // fflate 对损坏包抛英文异常，统一转中文提示（透传到市场 lastError 展示）
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zipData)
  } catch {
    throw new Error('包文件不是合法 zip 或已损坏')
  }
  // 解压炸弹防线：文件数与解压总量双上限（全内存同步解压，超限直接拒绝）
  const entries = Object.entries(files)
  if (entries.length > MARKET_MAX_FILE_COUNT) throw new Error('包内文件数超过上限（2000）')
  let total = 0
  for (const [, content] of entries) {
    total += content.byteLength
    if (total > MARKET_MAX_UNCOMPRESSED) throw new Error('包解压总量超过上限（100MB）')
  }
  const manifestRaw = files['manifest.json']
  if (!manifestRaw) throw new Error('包内缺少 manifest.json（清单必须位于包根）')
  let manifest: unknown
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestRaw))
  } catch {
    throw new Error('manifest.json 不是合法 JSON')
  }
  const m = manifest as Record<string, unknown>
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) throw new Error('manifest.id 不是合法反向域 id')
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) throw new Error('manifest.version 不是合法 semver 三段版本')
  if (typeof m.name !== 'string' || m.name.trim() === '') throw new Error('manifest.name 不能为空')
  if (typeof m.entry !== 'string' || !m.entry.endsWith('.mjs')) throw new Error('manifest.entry 必须是 .mjs 文件')
  if (!files[m.entry]) throw new Error(`包内缺少入口文件 ${m.entry}`)
  return { manifest: { id: m.id, name: m.name, version: m.version, entry: m.entry }, files }
}

/** 安装一个 zip 包数据：机械校验 → 落盘为不可变代际 → 登记清单（同版本重装 = 覆盖程序资源） */
function installZipData(zipData: Uint8Array): InstalledPluginView {
  const { manifest, files } = extractZip(zipData)
  const sha256 = createHash('sha256').update(zipData).digest('hex')
  const dir = versionDir(manifest.id, manifest.version)
  // 重装同版本：程序资源允许覆盖（用户数据不走此路径，不受代际纪律约束）
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith('/')) continue
    const target = path.resolve(dir, name)
    if (!target.startsWith(dir + path.sep) && target !== dir) throw new Error(`包内路径越界：${name}`)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  const data = readInstalled()
  let record = data.plugins.find((p) => p.id === manifest.id)
  if (!record) {
    record = { id: manifest.id, name: manifest.name, enabled: true, activeVersion: manifest.version, versions: [] }
    data.plugins.push(record)
  }
  record.name = manifest.name
  const existing = record.versions.find((v) => v.version === manifest.version)
  if (existing) {
    existing.sha256 = sha256
    existing.installedAt = Date.now()
  } else {
    record.versions.push({ version: manifest.version, sha256, installedAt: Date.now() })
  }
  record.activeVersion = manifest.version
  writeInstalled(data)
  return toView(record)
}

function toView(record: InstalledPlugin): InstalledPluginView {
  const dir = versionDir(record.id, record.activeVersion)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { entry: string }
  const entryPath = path.resolve(dir, manifest.entry)
  // 入口必须仍在版本目录内（防清单被篡改后拼出越界路径绕过协议白名单）
  if (!entryPath.startsWith(dir + path.sep)) throw new Error(`插件 ${record.id} 入口路径越界`)
  return {
    id: record.id,
    name: record.name,
    version: record.activeVersion,
    enabled: record.enabled,
    versions: record.versions.map((v) => v.version),
    entryPath,
    origin: 'market',
  }
}

/** 卸载：删除该插件全部版本目录并移出清单（项目插件不经此路径，无删除入口） */
function uninstall(id: string): boolean {
  const data = readInstalled()
  const record = data.plugins.find((p) => p.id === id)
  if (!record) return false
  rmSync(versionDir(id, record.activeVersion), { recursive: true, force: true })
  for (const v of record.versions) rmSync(versionDir(id, v.version), { recursive: true, force: true })
  data.plugins = data.plugins.filter((p) => p.id !== id)
  writeInstalled(data)
  return true
}

function setEnabled(id: string, enabled: boolean): boolean {
  const data = readInstalled()
  const record = data.plugins.find((p) => p.id === id)
  if (!record) return false
  record.enabled = enabled
  writeInstalled(data)
  return true
}

/** 切换激活指针（回滚 = 指向已装旧版；版本目录不删除） */
function setActiveVersion(id: string, version: string): boolean {
  const data = readInstalled()
  const record = data.plugins.find((p) => p.id === id)
  if (!record || !record.versions.some((v) => v.version === version)) return false
  record.activeVersion = version
  writeInstalled(data)
  return true
}

/** 已安装视图清单：单条降级——某代际目录缺失/清单不完整时跳过该条，
 * 不阻塞其余插件呈现（先删目录后写清单的崩溃窗口容错） */
function listInstalled(): InstalledPluginView[] {
  const views: InstalledPluginView[] = []
  for (const record of readInstalled().plugins) {
    try {
      views.push(toView(record))
    } catch (error) {
      console.error(`插件 ${record.id} 视图构建失败，已跳过：`, error instanceof Error ? error.message : error)
    }
  }
  return views
}

/** 市场索引地址（静态托管定稿）；测试与私有部署经环境变量覆盖 */
const MARKET_INDEX_URL = process.env.MX_MARKET_INDEX_URL ?? 'https://plugins.mindx.work/index.json'

/** 资源上限（防解压炸弹与超大包打爆主进程）：下载体 ≤ 50MB、解压总量 ≤ 100MB、文件数 ≤ 2000 */
const MARKET_MAX_ZIP_BYTES = 50 * 1024 * 1024
const MARKET_MAX_UNCOMPRESSED = 100 * 1024 * 1024
const MARKET_MAX_FILE_COUNT = 2000

/** 私网/保留 IPv4 网段（字节前缀）：0/8 本网、10/8 私网、100.64/10 CGNAT、127/8 回环、
 * 169.254/16 链路本地、172.16/12 私网、192.168/16 私网 */
const DENIED_V4_PREFIX: Array<{ bytes: number[]; prefix: number }> = [
  { bytes: [0], prefix: 8 },
  { bytes: [10], prefix: 8 },
  { bytes: [100, 64], prefix: 10 },
  { bytes: [127], prefix: 8 },
  { bytes: [169, 254], prefix: 16 },
  { bytes: [172, 16], prefix: 12 },
  { bytes: [192, 168], prefix: 16 },
]

function isDeniedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  return DENIED_V4_PREFIX.some(({ bytes, prefix }) => {
    const full = Math.floor(prefix / 8)
    for (let i = 0; i < full; i++) {
      if (parts[i] !== bytes[i]) return false
    }
    const rem = prefix % 8
    if (rem === 0) return true
    const mask = 0xff << (8 - rem)
    return (parts[full] & mask) === (bytes[full] & mask)
  })
}

function isDeniedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  // IPv4 映射地址（::ffff:a.b.c.d）提取 v4 部分复用判定
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isDeniedIpv4(mapped[1])
  // 唯一本地 fc00::/7 与链路本地 fe80::/10
  return /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower)
}

function isDeniedIp(ip: string): boolean {
  if (isIP(ip) === 4) return isDeniedIpv4(ip)
  if (isIP(ip) === 6) return isDeniedIpv6(ip)
  return true // 非 IP 字面量按拒绝处理
}

/** SSRF 防线：断言 URL 指向公网——IP 字面量直接判定；域名解析出全部地址逐个判定。
 * 边界说明：net 拨号层无法注入自定义解析，DNS rebinding 的理论窗口仍在；
 * 配合"手动跟随重定向、逐跳复检 + 每跳现查 DNS"已收窄到工程可接受 */
async function assertPublicUrl(url: string): Promise<void> {
  const { hostname } = new URL(url)
  if (isIP(hostname)) {
    if (isDeniedIp(hostname)) throw new Error('插件包地址指向内网，已拒绝')
    return
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('插件包地址域名解析失败')
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isDeniedIp(address))) {
    throw new Error('插件包地址指向内网，已拒绝')
  }
}

/** 信任边界：env 显式覆盖市场源 = 开发者/私有部署的本机手势（本地验收指向 127.0.0.1 合法），
 * 该模式下市场源与其给出的包地址全部可信；生产（env 缺省）强制公网。
 * 渲染进程无法篡改主进程 env，边界成立 */
const DEV_MARKET_MODE = process.env.MX_MARKET_INDEX_URL != null

async function assertMarketUrlAllowed(url: string): Promise<void> {
  if (DEV_MARKET_MODE) return
  await assertPublicUrl(url)
}

/** 市场下载（SSRF 防线）：禁自动重定向，逐跳断言后才请求；总超时 + 体积上限 */
async function fetchMarketResource(url: string, timeoutMs: number): Promise<Uint8Array> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let current = url
    for (let hop = 0; hop < 5; hop++) {
      await assertMarketUrlAllowed(current)
      // net.fetch 网络层异常为英文（如 Failed to fetch），统一转中文提示并保留原始原因
      let res: Response
      try {
        res = await net.fetch(current, { signal: controller.signal, redirect: 'manual' })
      } catch (error) {
        if (controller.signal.aborted) throw new Error('插件包下载超时')
        throw new Error(`插件包下载网络错误：${error instanceof Error ? error.message : String(error)}`)
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) throw new Error('插件包下载重定向缺少目标地址')
        current = new URL(location, current).href
        continue
      }
      if (!res.ok) throw new Error(`插件包下载失败（HTTP ${res.status}）`)
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > MARKET_MAX_ZIP_BYTES) throw new Error('插件包超过大小上限（50MB）')
      const data = new Uint8Array(await res.arrayBuffer())
      if (data.byteLength > MARKET_MAX_ZIP_BYTES) throw new Error('插件包超过大小上限（50MB）')
      return data
    }
    throw new Error('插件包下载重定向次数过多')
  } finally {
    clearTimeout(timer)
  }
}

/** 从市场 URL 下载 zip 并走同一安装管线；期望 sha256 非空时做完整性比对（指纹归一后比对） */
async function installFromUrl(url: string, expectedSha256?: string): Promise<InstalledPluginView> {
  if (!/^https?:\/\/\S+$/.test(url)) throw new Error('插件包地址非法')
  const data = await fetchMarketResource(url, 30_000)
  if (expectedSha256) {
    const expected = expectedSha256.trim().toLowerCase()
    if (expected !== createHash('sha256').update(data).digest('hex')) {
      throw new Error('插件包完整性校验失败：与市场清单 sha256 不符')
    }
  }
  return installZipData(data)
}

/** 协议文件后缀白名单与 MIME（插件包资源仅限声明性资源与脚本入口） */
const MIME_BY_EXT: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** mx-plugin 协议处理：host = 插件 id，path = <版本>/<文件>。
 * 机械校验（id/version 格式 + 路径不越界 + 后缀白名单）后回读版本目录内文件 */
export function registerPluginProtocol(): void {
  protocol.handle('mx-plugin', (request) => {
    try {
      const url = new URL(request.url)
      const id = url.hostname
      const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean)
      if (segments.length < 2) return new Response('路径须为 <版本>/<文件>', { status: 400 })
      const [version, ...fileParts] = segments
      if (!ID_RE.test(id) || !VERSION_RE.test(version)) {
        return new Response('插件 id 或版本格式非法', { status: 400 })
      }
      const dir = versionDir(id, version)
      const target = path.resolve(dir, ...fileParts)
      if (!target.startsWith(dir + path.sep)) return new Response('路径越界', { status: 403 })
      const ext = path.extname(target)
      const mime = MIME_BY_EXT[ext]
      if (!mime || !existsSync(target)) return new Response('文件不存在或类型不允许', { status: 404 })
      return net.fetch(pathToFileURL(target).href)
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 500 })
    }
  })
}

/** IPC 注册：全部要求窗口内发起（契约 §17 边界校验） */
export function registerPluginBridge(): void {
  console.log('插件安装目录：', pluginsRoot())
  ipcMain.handle('plugins:list', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    return listInstalled()
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
      return { ok: true, plugin: installZipData(new Uint8Array(readFileSync(file))) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('plugins:market-list', async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    // 机械层只透传解析后的索引 JSON；结构校验在渲染侧消费处执行（契约 §17 边界分工）
    const res = await net.fetch(MARKET_INDEX_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`市场索引拉取失败（HTTP ${res.status}）`)
    return JSON.parse(new TextDecoder().decode(await res.arrayBuffer()))
  })
  ipcMain.handle('plugins:install-from-url', async (event, url: unknown, sha256: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof url !== 'string') {
      return { ok: false, message: '拒绝非法调用' }
    }
    try {
      return { ok: true, plugin: await installFromUrl(url, typeof sha256 === 'string' ? sha256 : undefined) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('plugins:uninstall', (event, id: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string') return false
    return uninstall(id)
  })
  ipcMain.handle('plugins:set-enabled', (event, id: unknown, enabled: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || typeof enabled !== 'boolean') return false
    return setEnabled(id, enabled)
  })
  ipcMain.handle('plugins:set-active-version', (event, id: unknown, version: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || typeof version !== 'string') return false
    return setActiveVersion(id, version)
  })
}
