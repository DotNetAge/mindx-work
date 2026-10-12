/**
 * 插件存储核心（纯 Node，无 Electron 依赖）：工厂注入安装根目录。
 * 双消费方：主进程 IPC 层（plugins.ts，root = app userData）与 mw CLI
 * （cli.ts，ELECTRON_RUN_AS_NODE 模式下 electron API 不可用，root 按平台 userData 约定推导）。
 * 职责 = zip 包安装（解压/落盘）、版本目录管理（不可变代际 + 激活指针）、安装清单读写、市场下载（SSRF 防线）。
 * 语义校验分工（契约 §17）：本模块只做防路径穿越的机械校验（id/version 字符格式、entry 存在）；
 * 契约全量校验（字段完整性/mxApiVersion）在渲染侧加载前由 ui-shell 的 manifestIssues 统一执行（唯一家）。
 * 持久化代际纪律：版本目录是不可变代际——更新不删旧版（回滚 = 切激活指针），
 * 仅显式卸载删除；installed.json 只增字段（schemaVersion 单调）。
 */
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { unzipSync, zipSync } from 'fflate'

/** 已安装插件某代际记录（只增字段） */
export interface InstalledVersion {
  version: string
  /** 包文件哈希（市场安装时用于与 index.json 期望值比对；本地安装仅记录） */
  sha256: string
  installedAt: number
  /** 市场发布时间（epoch ms；市场安装时记录货架 publishedAt，本地导入无此值） */
  publishedAt?: number
}

/** 已安装插件记录：id 是身份，versions 是不可变代际列表，activeVersion 是激活指针 */
export interface InstalledPlugin {
  id: string
  name: string
  enabled: boolean
  activeVersion: string
  versions: InstalledVersion[]
  /** 安装来源（缺省 market）：core-optional = 官方可选件从发行搭载资源释放安装 */
  origin?: 'market' | 'core-optional'
}

/** 安装清单（plugins/installed.json）；schemaVersion 单调递增，只增字段 */
interface InstalledFile {
  schemaVersion: 1
  plugins: InstalledPlugin[]
}

/** 渲染侧/CLI 视图：含目录绝对路径（供动态 import 入口） */
export interface InstalledPluginView {
  id: string
  name: string
  version: string
  enabled: boolean
  /** 该插件全部已装版本（新→旧仅按安装时间） */
  versions: string[]
  /** 入口绝对路径（file:// import 用） */
  entryPath: string
  /** 安装来源（市场货架 / 官方可选件释放） */
  origin: 'market' | 'core-optional'
  /** 作者（激活代际包内 manifest 透传；缺失显示 —） */
  author?: string
  /** 一句话描述（激活代际 manifest 透传；插件页卡片头副行展示） */
  description?: string
  /** 许可证（SPDX，激活代际 manifest 透传；插件页卡片「授权」行） */
  license?: string
  /** 源码库地址（Github 等，激活代际 manifest 透传） */
  repo?: string
  /** 插件唯一指纹（sha256(canonical({author,id,version}))，激活代际 manifest 透传） */
  fingerprint?: string
  /** 发布日期（epoch ms；市场安装时记录货架 publishedAt，本地导入无此值） */
  publishedAt?: number
}

/** 机械校验正则（与 ui-shell plugin-manifest 的语义校验重复最小必要项：
 * 拼 id/version 落盘路径前必须先过格式关防路径穿越） */
export const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
export const VERSION_RE = /^\d+\.\d+\.\d+$/

/** 壳契约版本（镜像 ui-shell/src/plugin-manifest.ts 的 MX_API_VERSION；electron 与 ui-shell
 * 是独立编译单元——ui-shell 包 main 指向 TS 源码，主进程运行时无法 require，故镜像此常量。
 * manifest 契约字段冻结于该版本；修订必须与 ui-shell manifestIssues 双向同步，见规范 §5） */
export const MX_API_VERSION = '1'

/** URL 格式（http/https）——manifest 可选字段 repo/url 的机械校验用 */
const URL_RE = /^https?:\/\/\S+$/

/** 插件指纹重算：sha256(canonical JSON)。canonical 规范（与 mindx-market 服务端
 * manifestbuild.PluginFingerprint 逐字节一致）：{"author","id","version"} 三键按字母序
 * 紧凑序列化，非 ASCII 保留 UTF-8 原文（JS JSON.stringify 同语义） */
export function pluginFingerprint(id: string, author: string, version: string): string {
  return createHash('sha256').update(JSON.stringify({ author, id, version }), 'utf8').digest('hex')
}

/** 打包回执：产物路径与包身份（CLI --json 与人读输出共用） */
export interface PackedPlugin {
  path: string
  id: string
  version: string
  fingerprint: string
  /** 包文件整体 sha256（发布时与市场清单同口径） */
  sha256: string
}

/** 资源上限（防解压炸弹与超大包打爆进程）：下载体 ≤ 50MB、解压总量 ≤ 100MB、文件数 ≤ 2000 */
export const MARKET_MAX_ZIP_BYTES = 50 * 1024 * 1024
export const MARKET_MAX_UNCOMPRESSED = 100 * 1024 * 1024
export const MARKET_MAX_FILE_COUNT = 2000

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
  const parts = ip.split('.').map((x) => Number(x))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  return DENIED_V4_PREFIX.some(({ bytes, prefix }) => {
    const full = Math.floor(prefix / 8)
    const rem = prefix % 8
    if (full > 0 && bytes.slice(0, full).some((b, i) => parts[i] !== b)) return false
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

/** 信任边界：MX_MARKET_DEV 显式置值 = 开发者/私有部署的本机手势（本地验收指向
 * 127.0.0.1 的市场源合法），该模式下市场源与其给出的包地址全部可信；
 * 生产（env 缺省）强制公网。CLI 进程的 env 由发起方（终端）决定，本机用户即信任主体，边界与 app 一致 */
const DEV_MARKET_MODE = process.env.MX_MARKET_DEV != null

async function assertMarketUrlAllowed(url: string): Promise<void> {
  if (DEV_MARKET_MODE) return
  await assertPublicUrl(url)
}

export interface PluginStoreApi {
  /** 安装根目录（CLI 供展示与诊断） */
  root(): string
  /** 已安装视图清单：单条降级——某代际目录缺失/清单不完整时跳过该条，不阻塞其余 */
  list(): InstalledPluginView[]
  /** 安装 zip 数据：publishedAt 为市场发布时间（本地导入缺省）；origin 为安装来源（market / core-optional） */
  installZipData(zipData: Uint8Array, publishedAt?: number, origin?: 'market' | 'core-optional'): InstalledPluginView
  /** 从市场 URL 下载 zip 并走同一安装管线；期望 sha256 非空时做完整性比对；
   * publishedAt 为货架下发发布时间（epoch ms），随代际记录供卡片展示 */
  installFromUrl(url: string, expectedSha256?: string, publishedAt?: number): Promise<InstalledPluginView>
  uninstall(id: string): boolean
  setEnabled(id: string, enabled: boolean): boolean
  /** 切换激活指针（回滚 = 指向已装旧版；版本目录不删除） */
  setActiveVersion(id: string, version: string): boolean
  /** 导出激活代际为 zip（与安装包格式一致可重装）；返回写入路径，失败抛错 */
  exportToFile(id: string, target: string): string
  /** 打包目录 → .mindpkg（结构校验 + 指纹重算写入）；失败抛错 */
  packFromDirectory(dir: string, outPath: string): PackedPlugin
  /** 版本目录绝对路径（协议层拼文件路径用） */
  versionDirPath(id: string, version: string): string
}

/** 插件存储工厂：rootDir 由调用方注入（app = userData/plugins；CLI = 平台 userData 推导） */
export function createPluginStore(rootDir: string): PluginStoreApi {
  const pluginsRoot = (): string => rootDir

  const installedFilePath = (): string => path.join(pluginsRoot(), 'installed.json')

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

  /** 安装一个 zip 包数据：机械校验 → 落盘为不可变代际 → 登记清单（同版本重装 = 覆盖程序资源）；
   * publishedAt 为市场发布时间（本地导入缺省，仅随市场安装路径写入）；
   * origin 为安装来源（市场货架 market / 官方可选件释放 core-optional），随清单记录 */
  function installZipData(zipData: Uint8Array, publishedAt?: number, origin: 'market' | 'core-optional' = 'market'): InstalledPluginView {
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
      record = { id: manifest.id, name: manifest.name, enabled: true, activeVersion: manifest.version, versions: [], origin }
      data.plugins.push(record)
    }
    record.name = manifest.name
    if (origin !== 'market') record.origin = origin
    const existing = record.versions.find((v) => v.version === manifest.version)
    if (existing) {
      existing.sha256 = sha256
      existing.installedAt = Date.now()
      if (publishedAt !== undefined) existing.publishedAt = publishedAt
    } else {
      record.versions.push({ version: manifest.version, sha256, installedAt: Date.now(), ...(publishedAt !== undefined ? { publishedAt } : {}) })
    }
    record.activeVersion = manifest.version
    writeInstalled(data)
    return toView(record)
  }

  function toView(record: InstalledPlugin): InstalledPluginView {
    const dir = versionDir(record.id, record.activeVersion)
    // 激活代际包内清单全量读取（author/repo/fingerprint 供插件页卡片展示；
    // 机械读取不校验——语义校验唯一家在 ui-shell manifestIssues，加载前执行）
    let manifest: Record<string, unknown> = {}
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>
    } catch {
      // 清单缺失/损坏时维持旧口径（仅 entryPath 不可得即抛错；此处兜底让 entry 校验给出明确报错）
    }
    const entry = typeof manifest.entry === 'string' ? manifest.entry : ''
    const entryPath = path.resolve(dir, entry)
    // 入口必须仍在版本目录内（防清单被篡改后拼出越界路径绕过协议白名单）
    if (!entryPath.startsWith(dir + path.sep)) throw new Error(`插件 ${record.id} 入口路径越界`)
    const active = record.versions.find((v) => v.version === record.activeVersion)
    return {
      id: record.id,
      name: record.name,
      version: record.activeVersion,
      enabled: record.enabled,
      versions: record.versions.map((v) => v.version),
      entryPath,
      origin: record.origin ?? 'market',
      ...(typeof manifest.author === 'string' && manifest.author ? { author: manifest.author } : {}),
      ...(typeof manifest.description === 'string' && manifest.description ? { description: manifest.description } : {}),
      ...(typeof manifest.license === 'string' && manifest.license ? { license: manifest.license } : {}),
      ...(typeof manifest.repo === 'string' && manifest.repo ? { repo: manifest.repo } : {}),
      ...(typeof manifest.fingerprint === 'string' && manifest.fingerprint ? { fingerprint: manifest.fingerprint } : {}),
      ...(active?.publishedAt !== undefined ? { publishedAt: active.publishedAt } : {}),
    }
  }

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

  function setActiveVersion(id: string, version: string): boolean {
    const data = readInstalled()
    const record = data.plugins.find((p) => p.id === id)
    if (!record || !record.versions.some((v) => v.version === version)) return false
    record.activeVersion = version
    writeInstalled(data)
    return true
  }

  /** 递归收集目录下全部文件的相对路径（导出打包用；符号链接不跟随，readdirSync 只列实体） */
  function collectFiles(root: string, dir = root): string[] {
    const out: string[] = []
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) out.push(...collectFiles(root, full))
      else if (item.isFile()) out.push(path.relative(root, full))
    }
    return out
  }

  function exportToFile(id: string, target: string): string {
    const record = readInstalled().plugins.find((p) => p.id === id)
    if (!record) throw new Error('插件不存在或已卸载')
    const dir = versionDir(id, record.activeVersion)
    if (!existsSync(dir)) throw new Error('插件版本目录缺失，无法导出')
    const files: Record<string, Uint8Array> = {}
    for (const rel of collectFiles(dir)) {
      files[rel.split(path.sep).join('/')] = new Uint8Array(readFileSync(path.join(dir, rel)))
    }
    mkdirSync(path.dirname(path.resolve(target)), { recursive: true })
    writeFileSync(target, zipSync(files))
    return path.resolve(target)
  }

  /** 打包目录 → .mindpkg：manifest 结构校验（ui-shell manifestIssues 的 node 侧镜像，
   * 规则同步义务见插件生命周期规范 §5）→ fingerprint 重算写入（缺失补算 / 已填须一致）
   * → 收集目录文件 → 上限预检 → zipSync 落盘。排除源 manifest.json，以带指纹的序列化覆盖。 */
  function packFromDirectory(dir: string, outPath: string): PackedPlugin {
    if (!existsSync(dir)) throw new Error(`插件目录不存在：${dir}`)
    const manifestPath = path.join(dir, 'manifest.json')
    if (!existsSync(manifestPath)) throw new Error('目录缺少 manifest.json（清单必须位于项目根）')
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      throw new Error('manifest.json 不是合法 JSON')
    }

    // 结构校验：一次收集全部问题（规则镜像 ui-shell manifestIssues）
    const issues: string[] = []
    if (typeof manifest.id !== 'string' || !ID_RE.test(manifest.id)) {
      issues.push('id 必须是至少两段的反向域小写 id（如 com.example.viewer）')
    }
    if (typeof manifest.name !== 'string' || manifest.name.trim() === '') issues.push('name 不能为空')
    if (typeof manifest.version !== 'string' || !VERSION_RE.test(manifest.version)) {
      issues.push('version 必须是严格三段 semver（如 1.0.0）')
    }
    if (typeof manifest.description !== 'string' || manifest.description.trim() === '') {
      issues.push('description 不能为空')
    }
    if (typeof manifest.author !== 'string' || manifest.author.trim() === '') {
      issues.push('author 不能为空（署名必填）')
    }
    if (manifest.url !== undefined && (typeof manifest.url !== 'string' || !URL_RE.test(manifest.url))) {
      issues.push('url 必须是完整的 http(s) 地址')
    }
    if (manifest.repo !== undefined && (typeof manifest.repo !== 'string' || !URL_RE.test(manifest.repo))) {
      issues.push('repo 必须是完整的 http(s) 地址')
    }
    if (typeof manifest.license !== 'string' || manifest.license.trim() === '') {
      issues.push('license 不能为空（许可证必填，如 MIT）')
    }
    if (typeof manifest.entry !== 'string' || !manifest.entry.endsWith('.mjs')) {
      issues.push('entry 必须是 .mjs 入口文件名')
    }
    if (!Array.isArray(manifest.permissions) || manifest.permissions.some((p) => typeof p !== 'string')) {
      issues.push('permissions 必须是字符串数组')
    }
    if (manifest.mxApiVersion !== MX_API_VERSION) {
      issues.push(`mxApiVersion 必须为 ${MX_API_VERSION}（当前壳契约版本）`)
    }
    if (issues.length > 0) throw new Error(`manifest 校验失败：${issues.join('；')}`)

    const id = manifest.id as string
    const version = manifest.version as string
    const entry = manifest.entry as string
    if (!existsSync(path.join(dir, entry))) throw new Error(`目录缺少入口文件 ${entry}`)

    // 指纹：缺失补算写入；已填必须与重算一致（身份三元组绑定，防冒名）
    const fingerprint = pluginFingerprint(id, manifest.author as string, version)
    if (manifest.fingerprint !== undefined && manifest.fingerprint !== fingerprint) {
      throw new Error(`manifest.fingerprint 与身份三元组不符（应为 ${fingerprint.slice(0, 12)}…）；请重算或删除该字段由打包工具写入`)
    }
    manifest.fingerprint = fingerprint

    const files: Record<string, Uint8Array> = {}
    for (const rel of collectFiles(dir)) {
      if (rel === 'manifest.json') continue
      files[rel.split(path.sep).join('/')] = new Uint8Array(readFileSync(path.join(dir, rel)))
    }
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))

    // 上限预检（与安装管线同口径）
    const entries = Object.entries(files)
    if (entries.length > MARKET_MAX_FILE_COUNT) throw new Error('包内文件数超过上限（2000）')
    let total = 0
    for (const [, content] of entries) total += content.byteLength
    if (total > MARKET_MAX_UNCOMPRESSED) throw new Error('包解压总量超过上限（100MB）')

    const zip = zipSync(files)
    const target = path.resolve(outPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, zip)
    return {
      path: target,
      id,
      version,
      fingerprint,
      sha256: createHash('sha256').update(zip).digest('hex'),
    }
  }

  /** 市场下载（SSRF 防线）：禁自动重定向，逐跳断言后才请求；总超时 + 体积上限。
   * CLI 与主进程共用 node 全局 fetch（Electron 主进程同可用） */
  async function fetchMarketResource(url: string, timeoutMs: number): Promise<Uint8Array> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let current = url
      for (let hop = 0; hop < 5; hop++) {
        await assertMarketUrlAllowed(current)
        let res: Response
        try {
          res = await fetch(current, { signal: controller.signal, redirect: 'manual' })
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

  async function installFromUrl(url: string, expectedSha256?: string, publishedAt?: number): Promise<InstalledPluginView> {
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error('插件包地址非法')
    const data = await fetchMarketResource(url, 30_000)
    if (expectedSha256) {
      const expected = expectedSha256.trim().toLowerCase()
      if (expected !== createHash('sha256').update(data).digest('hex')) {
        throw new Error('插件包完整性校验失败：与进化网络发布的内容不一致')
      }
    }
    return installZipData(data, Number.isFinite(publishedAt) ? publishedAt : undefined)
  }

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

  return {
    root: pluginsRoot,
    list: listInstalled,
    installZipData,
    installFromUrl,
    uninstall,
    setEnabled,
    setActiveVersion,
    exportToFile,
    packFromDirectory,
    versionDirPath: versionDir,
  }
}
