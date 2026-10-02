/**
 * MindX 智能主机（daemon）本机安装服务（第三期，机制复刻 mindx-desktop daemon.ts——
 * 用户定稿：沿用同模式，做完反向对齐）。App 不接管 daemon 主进程生死：只做
 * 「安装 + 探测 + 经 launchd 拉起」，daemon 自有安装程序（mindx install）负责装配。
 *
 * 版本锚定纪律：版本唯一权威 = mindx 仓库 git tag；随包 version.json（build-mindx-bundle.mjs
 * 写盘）优先，回退本文件兜底字面量。禁止运行时改拉「latest release」——曾因此导致打包
 * 指明 2.5.6 而用户装到 2.5.3（mindx-desktop 事故实证）。
 *
 * 静默安装纪律：`mindx install -s`（跳过交互向导，专为 Client 子进程设计）失败不退出，
 * 转 `mindx doctor --fix` 修复/补装一次（runInstallWithFix 固定组合）。
 *
 * 启动纪律（macOS）：经 launchd 拉起（kickstart 不带 -k 防杀活实例），绝不把 daemon
 * 变成 Electron 子进程——继承 Electron 的 TCC 身份会落「系统受控沙箱、文件无法写入」。
 * Windows(WSL2) 分支第四期实施，当前返回 unsupported。
 */
import { app, ipcMain, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, promises as fsp, readdirSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { probeDaemonAlive } from './probe'

const execFileAsync = promisify(execFile)

// ── 版本解析：随包 version.json 优先，兜底字面量（resolve-mindx-version.mjs 的运行时对应） ──

export const MINDX_VERSION = resolveMindxRuntimeVersion() || '2.5.10'

function resolveMindxRuntimeVersion(): string {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(bundledMindxDir(), 'version.json'), 'utf8')
    ) as { version?: string }
    if (/^[\d.]+$/.test(raw.version ?? '')) return raw.version as string
  } catch {
    // 随包资源缺失（开发态/漏跑打包脚本），走兜底字面量
  }
  return ''
}

const GH_REPO = 'DotNetAge/mindx'
// mindx daemon 仅监听 WebSocket 网关端口 1314；HTTP 探测不可用（1314 是 WebSocket 网关，
// 非升级请求会被直接断开），探活只做 TCP 连通性
const GATEWAY_PORT = 1314

// mindx 官方 install 目标目录（全局指令位）
export const GLOBAL_BIN = path.join(homedir(), '.mindx', 'bin', 'mindx')
// libonnxruntime 的随包释放位：gorag/embedder 的库搜索路径以 ~/.mindx/lib 优先（免提权；
// Apple Silicon 上 /usr/local 归 root，会触发管理员授权弹窗——mindx-desktop 实证）
export const USER_LIB_DIR = path.join(homedir(), '.mindx', 'lib')
// BGE 语义模型（分发包自带）的释放位；缺该文件则 daemon 端语义记忆静默禁用
export const MODEL_DST = path.join(homedir(), '.mindx', 'data', 'models', 'model.onnx')
// 缓存目录：仅用于存下载的 tar 临时文件（本 App 专属用户数据目录下）
const CACHE_DIR = path.join(homedir(), '.mindx', 'data', 'studio', 'cache')
// 首次装配（mindx install）在未初始化环境会进交互向导；给超时避免 App 永久挂起
const INSTALL_TIMEOUT_MS = 90_000

// ── 状态机 ──

export type InstallerState =
  | 'boot'
  | 'detecting'
  | 'downloading'
  | 'extracting'
  | 'registering'
  | 'starting'
  | 'ready'
  | 'error'
  | /** 当前平台无内置分发（Windows 第四期 WSL 分支） */ 'unsupported'

export interface InstallerStatus {
  state: InstallerState
  /** 下载进度 0-100；非下载阶段为 null */
  progress?: number | null
  /** 人类可读的阶段/错误信息（对用户「讲人话」，给出可操作的下一步） */
  message?: string
  /** 原始错误详情（stderr/命令输出），供用户一键复制反馈给开发者做深度诊断 */
  errorDetail?: string
  /** 全局二进制安装位置 */
  installDir?: string
}

/** 平台资产名与锁定版本下载 URL；Windows 无原生构建（第四期 WSL 分支）标记 unsupported */
function targetAsset(): { url: string; version: string; unsupported: boolean } {
  let goos: string
  if (process.platform === 'darwin') goos = 'darwin'
  else if (process.platform === 'linux') goos = 'linux'
  else return { url: '', version: '', unsupported: true }
  const goarch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  return {
    url: `https://github.com/${GH_REPO}/releases/download/v${MINDX_VERSION}/mindx-${MINDX_VERSION}-${goos}-${goarch}.tar.gz`,
    version: MINDX_VERSION,
    unsupported: false,
  }
}

// ── 工具函数（照抄 mindx-desktop daemon.ts） ──

/** 幂等清除 macOS quarantine 扩展属性：带该属性的二进制交给 launchd/Gatekeeper 拉起时
 * 行为不可控（可能被限制执行或静默拒启），且经安装引导拉起的进程会继承异常 TCC 归属 */
async function clearQuarantine(binPath: string): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    await execFileAsync('xattr', ['-d', 'com.apple.quarantine', binPath])
  } catch {
    // 无该属性 / xattr 不可用：均为预期，忽略
  }
}

/** 健康探测：网关端口 TCP 可连即视为 daemon 已在运行。App 启动早期网络栈/launchd 可能
 * 瞬时抖动：单次失败间隔 500ms 重试 2 次，三次全失败才判定不可用，避免误判触发无谓拉起 */
async function isDaemonUp(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(500)
    if (await probeDaemonAlive(GATEWAY_PORT)) return true
  }
  return false
}

/** 轮询等待 daemon 就绪（launchd/服务管理器拉起需时间，单次探测易误报失败） */
async function waitDaemonUp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isDaemonUp()) return true
    await sleep(700)
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 确保 ~/.mindx/bin 在用户终端的 PATH 上：向 ~/.zshrc 追加 export 行（幂等，已存在则跳过）。
 * 只影响新开的终端会话；App 自身调用 mindx 走绝对路径，不依赖此配置，写失败也不阻塞安装 */
export async function ensureGlobalBinOnPath(): Promise<void> {
  if (process.platform === 'win32') return
  const rc = path.join(homedir(), '.zshrc')
  try {
    let content = ''
    try {
      content = await fsp.readFile(rc, 'utf8')
    } catch {
      // 文件不存在则新建
    }
    if (content.includes('.mindx/bin')) return
    const base = content ? (content.endsWith('\n') ? content : `${content}\n`) : ''
    await fsp.writeFile(rc, `${base}# mindx CLI\nexport PATH="$HOME/.mindx/bin:$PATH"\n`, 'utf8')
  } catch {
    // 忽略写入失败（权限等），不影响安装主流程
  }
}

/** 随包资源目录（extraResources 注入位：Contents/Resources/mindx）；
 * 开发态 resourcesPath 指向 node_modules/electron/dist，读不到随包资源属预期 */
function bundledMindxDir(): string {
  // 打包态：进程资源目录（extraResources 注入的 Contents/Resources/mindx）。
  // dev 态：__dirname = electron/dist，取 electron/resources/mindx（与打包同源的构建产物目录）
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mindx')
    : path.join(__dirname, '..', 'resources', 'mindx')
}

/** 随包 mindx 归档：只精确匹配 MINDX_VERSION 对应文件名——目录中混入的历史版本归档一律忽略
 * （宽松匹配会误选历史残留，曾导致打包 2.5.6 装到旧版）。找不到（开发态）返回 null */
function bundledMindxArchive(): string | null {
  const goarch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  try {
    const exact = `mindx-${MINDX_VERSION}-darwin-${goarch}.tar.gz`
    const hit = readdirSync(bundledMindxDir()).find((f) => f === exact)
    return hit ? path.join(bundledMindxDir(), hit) : null
  } catch {
    return null
  }
}

/** 随包的 Microsoft onnxruntime 官方 macOS 包（架构经打包期裁剪保证与当前一致） */
function bundledOrtArchive(): string | null {
  const ortArch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  try {
    const hit = readdirSync(bundledMindxDir()).find(
      (f) => f.startsWith(`onnxruntime-osx-${ortArch}-`) && f.endsWith('.tgz')
    )
    return hit ? path.join(bundledMindxDir(), hit) : null
  } catch {
    return null
  }
}

/** 用户库目录是否已有 libonnxruntime 依赖（目录不存在或为空视为未安装，须重新释放） */
function onnxRuntimeInstalled(): boolean {
  try {
    return readdirSync(USER_LIB_DIR).some((f) => f.startsWith('libonnxruntime.'))
  } catch {
    return false
  }
}

/**
 * 把 libonnxruntime.* 装到 ~/.mindx/lib（免提权释放位）。dylib 来源两级，随包归档优先：
 *   1. 随包 onnxruntime 官方包（架构经打包期保证）；
 *   2. mindx 分发包解压目录里的文件（未来 release 若自带架构配对的 dylib）。
 * 不随包优先的原因：v2.5.4 的 darwin-amd64 分发包内误装 arm64 dylib（x86_64 进程 dlopen 必败），
 * staging 来源无法自证架构正确。官方包内 dylib 是符号链接链，必须 cp -P 保留链接。
 */
async function installOnnxRuntime(staging: string): Promise<void> {
  await fsp.mkdir(USER_LIB_DIR, { recursive: true })
  let srcs: string[] = []

  const ortArchive = bundledOrtArchive()
  if (ortArchive != null) {
    const ortStaging = path.join(staging, 'onnxruntime')
    mkdirSync(ortStaging, { recursive: true })
    await execFileAsync('tar', ['-xzf', ortArchive, '-C', ortStaging])
    srcs = await findDylibs(ortStaging)
  }
  if (srcs.length === 0) {
    srcs = (await fsp.readdir(staging))
      .filter((f) => f.startsWith('libonnxruntime.'))
      .map((f) => path.join(staging, f))
  }
  if (srcs.length === 0) {
    throw new Error('分发包与随包资源中均未包含 libonnxruntime 依赖')
  }
  await execFileAsync('cp', ['-P', ...srcs, USER_LIB_DIR])
}

/** 递归查找目录下所有 libonnxruntime.* 文件（含符号链接本体） */
async function findDylibs(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await findDylibs(p)))
    } else if (e.name.startsWith('libonnxruntime.')) {
      out.push(p)
    }
  }
  return out
}

/** 在线下载（回退路径；随包产物是主路径）：fetch 流式写盘 + 进度回调。断点续传从简——
 * 第三期先实施简化方案，全量重下可接受，失败抛错由调用方呈现 */
async function downloadArchive(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) })
  if (!response.ok || !response.body) {
    throw new Error(`下载失败（HTTP ${response.status}）：${url}`)
  }
  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)))
  })
  await pipeline(source, createWriteStream(dest))
}

/**
 * 经 launchd 触发已注册的 mindx daemon（macOS 专有）。架构边界：mindx 是主服务（大脑），
 * 本 App 只做「手脚」——由 launchd 以 daemon 自身身份拉起，绝不把 daemon 变成 Electron
 * 的子进程。优先 kickstart（不带 -k：服务已运行时无操作，仅未运行时拉起；-k 会无条件
 * 杀掉活实例再重启——曾导致会话状态全部丢失），未加载则 bootstrap（RunAtLoad=true 自动启动）。
 */
async function startViaLaunchd(): Promise<void> {
  const uid = userInfo().uid
  const service = `gui/${uid}/com.mindx.daemon`
  const agentPlist = path.join(homedir(), 'Library', 'LaunchAgents', 'com.mindx.daemon.plist')
  try {
    await execFileAsync('launchctl', ['kickstart', service])
    return
  } catch {
    // 服务未加载：bootstrap 载入 plist（RunAtLoad=true 触发启动）
  }
  await execFileAsync('launchctl', ['bootstrap', `gui/${uid}`, agentPlist])
}

/** 把安装/拉起过程中的原始异常翻译成「讲人话」的可执行提示，同时保留原始详情供复制诊断 */
function humanizeError(raw: string): { message: string; detail: string } {
  const detail = raw.trim()
  const lo = detail.toLowerCase()
  if (lo.includes('eacces') || lo.includes('permission denied')) {
    return {
      message: '没有足够的权限写入安装位置。请重试；若仍失败请复制诊断信息反馈。',
      detail,
    }
  }
  if (lo.includes('enospc')) {
    return { message: '磁盘空间不足，请清理后重试。', detail }
  }
  return { message: '安装失败。请重试；若仍失败请复制诊断信息反馈。', detail }
}

// ── 安装管理器（状态机 + 幂等 ensure） ──

type StatusListener = (status: InstallerStatus) => void

class MindxInstaller {
  private state: InstallerState = 'boot'
  private progress: number | null = null
  private message = ''
  private errorDetail: string | undefined
  private ensurePromise: Promise<InstallerStatus> | null = null
  private listeners = new Set<StatusListener>()

  getStatus(): InstallerStatus {
    return this.status()
  }

  /** 订阅状态变化（IPC 广播；返回退订函数） */
  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private status(): InstallerStatus {
    const base: InstallerStatus = { state: this.state }
    if (this.progress != null) base.progress = this.progress
    if (this.message) base.message = this.message
    if (this.errorDetail) base.errorDetail = this.errorDetail
    base.installDir = GLOBAL_BIN
    return base
  }

  private setState(partial: Partial<InstallerStatus>): void {
    if (partial.state != null) this.state = partial.state
    // progress 显式传 null 表示重置（退出下载阶段）；不传则保持不变
    if (partial.progress !== undefined) this.progress = partial.progress ?? null
    if (partial.message != null) this.message = partial.message
    if (partial.errorDetail !== undefined) this.errorDetail = partial.errorDetail ?? undefined
    const next = this.status()
    for (const listener of this.listeners) listener(next)
  }

  /** 确保本地 daemon 就绪：仅做「安装 + 探测」，不接管主进程。
   * 已在运行 → 直接就绪；未装 → 下载放置二进制与依赖 + 调 mindx install 自装配；
   * 未启动 → 拉起。幂等：并发调用只触发一次 */
  ensure(): Promise<InstallerStatus> {
    if (this.ensurePromise == null) {
      this.ensurePromise = this.run().finally(() => {
        this.ensurePromise = null
      })
    }
    return this.ensurePromise
  }

  private async run(): Promise<InstallerStatus> {
    // Windows 无原生构建：WSL2 分支第四期实施
    if (process.platform === 'win32') {
      this.setState({
        state: 'unsupported',
        progress: null,
        message: 'Windows 平台的内置安装将在后续版本提供（WSL 方案），当前可先手动安装或使用远程主机。',
      })
      return this.status()
    }
    try {
      // 0. 已在运行 → 直接就绪
      this.setState({ state: 'detecting', progress: null, message: '正在检测本机智能主机…' })
      if (await isDaemonUp()) {
        this.markReady()
        return this.status()
      }

      // 1. 确保二进制就绪：全局指令位的 mindx（未装则下载放置 + 装依赖）
      const bin = await this.ensureBinary()

      // 2. 调 mindx install 自装配系统守护（未注册 daemon 时才跑）
      if (!(await this.daemonRegistered())) {
        this.setState({ state: 'registering', progress: null, message: '正在装配系统守护…' })
        if (!(await this.runInstallWithFix(bin))) {
          this.setState({ state: 'error', progress: null, message: '智能主机安装失败，请重试' })
          return this.status()
        }
      }

      // 3. 装配后探测；未启动则拉起。macOS 经 launchd 触发（daemon 由 launchd 以自身身份
      //    拉起，绝不作为本 App 子进程运行）；其它平台交给 mindx 自己的服务管理器。
      if (await isDaemonUp()) {
        this.markReady()
        return this.status()
      }
      this.setState({ state: 'starting', progress: null, message: '正在拉起本机智能主机…' })
      if (process.platform === 'darwin') {
        // 兜底：确保交给 launchd 的二进制无 quarantine（避免 Gatekeeper 限制执行）
        await clearQuarantine(bin)
        await startViaLaunchd()
      } else {
        await execFileAsync(bin, ['restart'])
      }
      // launchd/服务管理器拉起需时间：轮询等待，避免单次探测误判「未响应」
      if (await waitDaemonUp(30_000)) {
        this.markReady()
        return this.status()
      }
      this.setState({ state: 'error', progress: null, message: '智能主机未响应' })
      return this.status()
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // unsupported 由对应步骤内部置态，不在此覆盖为 error
      if (this.state !== 'unsupported') {
        const { message, detail } = humanizeError(raw)
        this.setState({ state: 'error', progress: null, message, errorDetail: detail || raw })
      }
      return this.status()
    }
  }

  /**
   * 返回可用的 mindx 二进制：全局指令位优先，其次系统 PATH；都没有则下载放置。
   * 拉起前另做校验：libonnxruntime 已装到库目录——初装先落二进制后装依赖，
   * 上次在装依赖前中断时须重新释放补齐。
   */
  private async ensureBinary(): Promise<string> {
    const bin = await this.findBinary()
    if (bin != null) {
      await ensureGlobalBinOnPath()
      if (!onnxRuntimeInstalled()) {
        return this.downloadAndPlace()
      }
      return bin
    }
    return this.downloadAndPlace()
  }

  /** 定位 mindx 二进制：全局指令位优先，其次系统 PATH；都没有返回 null。
   * 注：不能只靠 which 判断——App 是 GUI 进程不加载 .zshrc，可能查不到 ~/.mindx/bin */
  private async findBinary(): Promise<string | null> {
    if (existsSync(GLOBAL_BIN)) return GLOBAL_BIN
    try {
      const { stdout } = await execFileAsync('which', ['mindx'])
      const p = stdout.trim()
      if (p) return p
    } catch {
      // PATH 中无 mindx，忽略
    }
    return null
  }

  /** 下载 tar → 解压 → 二进制放到全局指令位 + libonnxruntime 依赖装到用户库目录。
   * 随包产物优先（安装包内已带匹配平台的 tar.gz，完全不碰网络，规避 GitHub 下载质量
   * 不可控风险）；缺失（开发态/漏打包）回退在线下载 */
  private async downloadAndPlace(): Promise<string> {
    const bundled = bundledMindxArchive()
    let archive: string
    if (bundled != null) {
      archive = bundled
      this.setState({ state: 'extracting', progress: null, message: '正在释放随包的智能主机…' })
    } else {
      const asset = targetAsset()
      if (asset.unsupported) {
        this.setState({
          state: 'unsupported',
          progress: null,
          message: '当前平台暂无内置安装（Windows 将在后续版本提供），请手动安装或使用远程主机。',
        })
        throw new Error('当前平台暂不支持内置安装')
      }

      mkdirSync(CACHE_DIR, { recursive: true })
      archive = path.join(CACHE_DIR, `mindx-${asset.version}.tgz`)

      this.setState({ state: 'downloading', progress: 0, message: '正在下载智能主机…' })
      await downloadArchive(asset.url, archive, (p) => {
        this.setState({ state: 'downloading', progress: p, message: '正在下载智能主机…' })
      })
    }

    const staging = path.join(CACHE_DIR, 'staging')
    mkdirSync(staging, { recursive: true })

    try {
      if (bundled == null) {
        this.setState({ state: 'extracting', progress: null, message: '正在解压智能主机…' })
      }
      await execFileAsync('tar', ['-xzf', archive, '-C', staging])

      // 二进制放到全局指令位
      const srcBin = path.join(staging, 'mindx')
      if (!existsSync(srcBin)) {
        throw new Error('解压后未找到 mindx 可执行文件')
      }
      await fsp.mkdir(path.dirname(GLOBAL_BIN), { recursive: true })
      await fsp.chmod(srcBin, 0o755)
      await fsp.rename(srcBin, GLOBAL_BIN)
      // 清除可能的 quarantine 属性，避免 launchd 拉起 daemon 时被 Gatekeeper 限制
      await clearQuarantine(GLOBAL_BIN)

      // 让终端能直接使用 mindx 命令：~/.mindx/bin 写入 ~/.zshrc 的 PATH（幂等）
      this.setState({ state: 'extracting', message: '正在配置命令行环境…' })
      await ensureGlobalBinOnPath()

      // libonnxruntime 装到用户库目录（staging 无 dylib 时回退解压随包 onnxruntime 官方包）
      this.setState({ state: 'extracting', message: '正在安装 onnxruntime 依赖…' })
      await installOnnxRuntime(staging)

      // BGE 语义模型：分发包自带 model.onnx，释放到 mindx 约定位
      const srcModel = path.join(staging, 'model.onnx')
      if (existsSync(srcModel) && !existsSync(MODEL_DST)) {
        this.setState({ state: 'extracting', message: '正在安装语义模型…' })
        await fsp.mkdir(path.dirname(MODEL_DST), { recursive: true })
        await fsp.copyFile(srcModel, MODEL_DST)
      }
    } finally {
      // 随包归档是安装包内的只读资产，绝不删除；只清理在线下载的临时归档与 staging
      await Promise.all([
        ...(bundled == null ? [fsp.rm(archive, { force: true })] : []),
        fsp.rm(staging, { recursive: true, force: true }),
      ])
    }
    return GLOBAL_BIN
  }

  /** 读取 ~/.mindx/mindx.json，判断是否已注册系统守护（避免重复执行 install） */
  private async daemonRegistered(): Promise<boolean> {
    const cfgPath = path.join(homedir(), '.mindx', 'mindx.json')
    try {
      const raw = await fsp.readFile(cfgPath, 'utf8')
      const j = JSON.parse(raw) as { Daemon?: { Installed?: boolean } }
      return j.Daemon?.Installed === true
    } catch {
      return false
    }
  }

  /**
   * 静默安装并将其升级为「失败自愈」：先 `mindx install -s`（跳过交互向导，供 Client
   * 子进程调用；90s 超时防永久挂起）；若失败不立即退出，改执行 `mindx doctor --fix`
   * 再尝试安装修复一次。返回是否最终装配成功。
   */
  private async runInstallWithFix(bin: string): Promise<boolean> {
    try {
      await execFileAsync(bin, ['install', '-s'], { timeout: INSTALL_TIMEOUT_MS })
      return true
    } catch {
      // install -s 失败不立即退出，转入 doctor --fix 尝试修复/补装（固化组合，同源先例）
      this.setState({ state: 'registering', progress: null, message: '装配失败，正在自动修复…' })
      try {
        await execFileAsync(bin, ['doctor', '--fix'], { timeout: INSTALL_TIMEOUT_MS })
        return true
      } catch {
        return false
      }
    }
  }

  private markReady(): void {
    this.setState({ state: 'ready', progress: null, message: '本机智能主机已就绪' })
  }
}

/** 全局单例（主进程唯一安装服务） */
export const mindxInstaller = new MindxInstaller()

// ── IPC 通道（常驻注册：向导「本机安装」步与设置页未来重试共用） ──

const INSTALLER_IPC = {
  status: 'mx-daemon-install:status',
  start: 'mx-daemon-install:start',
  log: 'mx-daemon-install:log',
  event: 'mx-daemon-install:event',
} as const

/** daemon 错误日志路径（mindx install/daemon 自身写入） */
const DAEMON_ERR_LOG = path.join(homedir(), '.mindx', 'logs', 'daemon.err.log')

/** 向全部窗口广播状态变化（向导窗 + 主窗都能收） */
function broadcast(status: InstallerStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(INSTALLER_IPC.event, status)
  }
}

/** 读取错误日志尾部（最多 200 行/256KB，防大日志拖垮 IPC）；不可读返回空串 */
async function readDaemonErrLog(): Promise<{ path: string; content: string }> {
  const maxLines = 200
  const maxBytes = 256 * 1024
  try {
    const stat = await fsp.stat(DAEMON_ERR_LOG)
    const start = Math.max(0, stat.size - maxBytes)
    const fh = await fsp.open(DAEMON_ERR_LOG, 'r')
    try {
      const buf = Buffer.alloc(stat.size - start)
      await fh.read(buf, 0, buf.length, start)
      let text = buf.toString('utf8')
      if (start > 0) text = text.slice(text.indexOf('\n') + 1)
      const lines = text.split('\n')
      if (lines.length > maxLines) {
        text = [`…（仅显示最后 ${maxLines} 行）`, ...lines.slice(-maxLines)].join('\n')
      }
      return { path: DAEMON_ERR_LOG, content: text }
    } finally {
      await fh.close()
    }
  } catch {
    return { path: DAEMON_ERR_LOG, content: '' }
  }
}

export function registerDaemonInstallerIpc(): void {
  ipcMain.removeHandler(INSTALLER_IPC.status)
  ipcMain.removeHandler(INSTALLER_IPC.start)
  ipcMain.removeHandler(INSTALLER_IPC.log)
  ipcMain.handle(INSTALLER_IPC.status, () => mindxInstaller.getStatus())
  ipcMain.handle(INSTALLER_IPC.start, () => mindxInstaller.ensure())
  ipcMain.handle(INSTALLER_IPC.log, () => readDaemonErrLog())
  mindxInstaller.onStatus(broadcast)
}
