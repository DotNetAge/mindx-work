/**
 * 首启向导探测服务（主进程，定稿 2026-10-02）：环境事实的只读收集，
 * 供向导门判定（事实派生，不写"已看过向导"标记）与路径建议。
 *
 * 探测项（定稿四件 + 凭据）：
 * - 1314 探活：TCP connect 127.0.0.1:1314（本机 daemon 存在性）
 * - ~/.mindx 目录与 WSL 注册表（registry.json）存在性
 * - docker info（Docker 路径可用性）
 * - wsl -l -v（仅 Windows；WSL_UTF8=1 + UTF-16LE 解码为继承实证）
 * - 凭据扫描：shell rc 只读解析（mac/Linux；Finder/Dock 双击启动拿不到 shell env，
 *   只读进程 env 会漏掉绝大多数手工配置——关键坑）→ Windows/兜底读进程 env。
 *
 * 凭据纪律（借鉴 deepseek-harness welcome-backend）：渲染层只见键名 + configured 状态位，
 * key 值留在主进程内存供"逐个验证"IPC 使用，任何 IPC 不回显明文。
 * IPC 通道族按需安装（mx-wizard-probe:*）：向导窗存在才注册、销毁即卸载，不污染主窗 IPC 面。
 */
import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/** 探测报告（渲染层唯一可见形态：全部是事实与状态位，无敏感值） */
export interface ProbeReport {
  platform: NodeJS.Platform
  /** 1314 探活：本机 daemon 是否存活 */
  daemonAlive: boolean
  /** ~/.mindx 目录存在 */
  mindxDirExists: boolean
  /** WSL 代次注册表存在（~/.mindx/data/studio/wsl/registry.json） */
  wslRegistryExists: boolean
  /** Docker 守护进程可用（docker info 成功） */
  dockerAvailable: boolean
  /** 本机正在运行的智能主机官方镜像容器（Docker 路径连接候选；docker ps 按 Image 前缀匹配） */
  dockerContainers: DockerContainerHit[]
  /** WSL 可用与发行版清单（仅 Windows 探测，其它平台恒 false/空） */
  wslAvailable: boolean
  wslDistros: string[]
  /** 扫描到的凭据键与状态位（无值——值只在主进程内存） */
  credentials: CredentialHit[]
}

export interface CredentialHit {
  /** 凭据环境变量键名（如 DEEPSEEK_API_KEY） */
  key: string
  /** 来源：shell rc 文件 / 进程 env */
  source: 'shellrc' | 'env'
}

/** 本机正在运行的智能主机官方镜像容器（官方镜像 hub.docker.com/r/dotnetage/mindx） */
export interface DockerContainerHit {
  /** 容器名（docker ps Names 字段） */
  name: string
  /** 宿主机映射端口（映射到容器 1314 的 hostPort；未映射为 null） */
  hostPort: number | null
  /** hostPort TCP 探活（WebSocket 服务端口可连即活） */
  alive: boolean
}

/** 单探测超时（ms）：探活要求快，外部工具（docker/wsl）放宽 */
const PING_TIMEOUT_MS = 800
const TOOL_TIMEOUT_MS = 3000

/** 识别的 LLM 凭据键（首启导入候选；键名清单与 daemon 模型供应商对齐，追加需两侧同步） */
const CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'DASHSCOPE_API_KEY',
  'ZHIPUAI_API_KEY',
  'ARK_API_KEY',
  'MINIMAX_API_KEY',
  'SILICONFLOW_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
] as const

/** 1314 探活：TCP 握手即认为 daemon 存活（daemon 是 WebSocket 服务，端口可连即活） */
export function probeDaemonAlive(port = 1314): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = (alive: boolean): void => {
      socket.destroy()
      resolve(alive)
    }
    socket.setTimeout(PING_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** shell rc 只读解析：逐行匹配 export KEY=value / KEY=value，跳过注释行；
 * 只返回命中的键名与来源，值不进报告（主进程内存另行持有，见 scanCredentialValues） */
function shellRcCandidates(): CredentialHit[] {
  if (process.platform === 'win32') return []
  const rcNames = ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile']
  const hits = new Map<string, CredentialHit>()
  for (const name of rcNames) {
    const file = path.join(os.homedir(), name)
    if (!existsSync(file)) continue
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line)
      if (!m || line.trimStart().startsWith('#')) continue
      const key = m[1] as (typeof CREDENTIAL_KEYS)[number]
      if ((CREDENTIAL_KEYS as readonly string[]).includes(key) && !hits.has(key)) {
        hits.set(key, { key, source: 'shellrc' })
      }
    }
  }
  return [...hits.values()]
}

/** 主进程内存持有凭据值（供"逐个验证"IPC 取用；永不透传渲染层） */
const credentialValues = new Map<string, string>()

/** 凭据扫描：shell rc 命中的键回读其值进主进程内存（渲染层只见状态位），
 * Windows/兜底补扫进程 env（GUI 启动继承用户注册表环境变量，Windows 读进程 env 即可靠） */
function scanCredentials(): CredentialHit[] {
  const hits = shellRcCandidates()
  const hitKeys = new Set(hits.map((h) => h.key))
  for (const hit of hits) {
    // shell rc 只读解析出的键：从 rc 行回读值（不执行 rc 文件，只做静态提取）
    const value = readShellRcValue(hit.key)
    if (value) credentialValues.set(hit.key, value)
  }
  for (const key of CREDENTIAL_KEYS) {
    const value = process.env[key]
    if (value) {
      credentialValues.set(key, value)
      if (!hitKeys.has(key)) hits.push({ key, source: 'env' })
    }
  }
  return hits
}

/** 从 rc 文件提取 KEY= 的值（静态解析，不带 shell 语义展开；缺省返回空串） */
function readShellRcValue(key: string): string {
  if (process.platform === 'win32') return ''
  const rcNames = ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile']
  for (const name of rcNames) {
    const file = path.join(os.homedir(), name)
    if (!existsSync(file)) continue
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(line)
      if (m) return (m[1] ?? m[2] ?? m[3] ?? '').trim()
    }
  }
  return ''
}

/** docker info 探测（超时静默失败 = 不可用） */
export async function probeDocker(): Promise<boolean> {
  try {
    await execFileP('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: TOOL_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

/** 官方镜像前缀（hub.docker.com/r/dotnetage/mindx；docker ps Image 字段含 tag，前缀匹配覆盖全部 tag） */
const MINDX_IMAGE_PREFIX = 'dotnetage/mindx'

/** 容器端口映射解析：从 docker ps Ports 字段提取映射到容器 1314 的宿主端口。
 * 字段形态实证（docker 标准 format）：`0.0.0.0:1314->1314/tcp, [::]:1314->1314/tcp` */
function parseHostPort(ports: string): number | null {
  const m = /(?:[\d.]+|\[[^\]]+\]):(\d+)->1314\/tcp/.exec(ports)
  return m ? Number(m[1]) : null
}

/** 枚举本机正在运行的智能主机官方镜像容器并对宿主端口探活。
 * 不用 ancestor filter（其 tag 匹配语义未实证），直接全列 docker ps 后按 Image 前缀匹配；
 * docker 不可用/无容器一律返回空数组（静默，与其它探测同式）。 */
export async function probeMindxContainers(): Promise<DockerContainerHit[]> {
  let stdout: string
  try {
    const result = await execFileP('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}'], {
      timeout: TOOL_TIMEOUT_MS,
    })
    stdout = result.stdout
  } catch {
    return []
  }
  const hits: DockerContainerHit[] = []
  for (const line of stdout.split('\n')) {
    const [name, image, ports] = line.split('\t')
    if (!name || !image?.startsWith(MINDX_IMAGE_PREFIX)) continue
    const hostPort = parseHostPort(ports ?? '')
    hits.push({ name, hostPort, alive: hostPort !== null ? await probeDaemonAlive(hostPort) : false })
  }
  return hits
}

/** wsl -l -v 探测（仅 Windows；WSL_UTF8=1 防 UTF-16LE 输出乱码——继承实证经验） */
async function probeWsl(): Promise<{ available: boolean; distros: string[] }> {
  if (process.platform !== 'win32') return { available: false, distros: [] }
  try {
    const { stdout } = await execFileP('wsl', ['-l', '-v'], {
      timeout: TOOL_TIMEOUT_MS,
      env: { ...process.env, WSL_UTF8: '1' },
    })
    // 输出形态：NAME STATE VERSION 表格；首行表头，后续行为发行版
    const distros = stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter((name) => name.length > 0)
    return { available: true, distros }
  } catch {
    return { available: false, distros: [] }
  }
}

/** 全量探测：单探测互不阻塞，allSettled 聚合（任一失败不影响其余事实） */
export async function runProbe(): Promise<ProbeReport> {
  const [daemonAlive, docker, wsl, containers] = await Promise.all([
    probeDaemonAlive().catch(() => false),
    probeDocker().catch(() => false),
    probeWsl().catch(() => ({ available: false, distros: [] })),
    probeMindxContainers().catch(() => []),
  ])
  const mindxDir = path.join(os.homedir(), '.mindx')
  return {
    platform: process.platform,
    daemonAlive,
    mindxDirExists: existsSync(mindxDir),
    wslRegistryExists: existsSync(path.join(mindxDir, 'data', 'studio', 'wsl', 'registry.json')),
    dockerAvailable: docker,
    dockerContainers: containers,
    wslAvailable: wsl.available,
    wslDistros: wsl.distros,
    credentials: scanCredentials(),
  }
}

/** 验证单条凭据：向凭据键对应的供应商发一次最小请求，成功/失败布尔（不回显 key）。
 * 键 → 验证端点映射（MINIMAX_API_KEY / GEMINI_API_KEY 暂无最小验证端点，走"暂不支持"分支） */
export async function verifyCredential(key: string): Promise<{ ok: boolean; reason?: string; modelHint?: string }> {
  const value = credentialValues.get(key)
  if (!value) return { ok: false, reason: '未找到该凭据的值' }
  const endpoint = VERIFY_ENDPOINTS[key]
  if (!endpoint) return { ok: false, reason: '暂不支持自动验证，可稍后在模型设置中手动添加' }
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...endpoint.headers(value) },
      body: JSON.stringify(endpoint.body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      // 401/403 = 凭据无效；其它状态视为网络/服务问题（不武断判无效）
      return response.status === 401 || response.status === 403
        ? { ok: false, reason: '凭据验证未通过（鉴权失败）' }
        : { ok: false, reason: `服务响应异常（HTTP ${response.status}）` }
    }
    return { ok: true, modelHint: endpoint.modelHint }
  } catch (error) {
    return { ok: false, reason: `网络请求失败：${error instanceof Error ? error.message : '未知错误'}` }
  }
}

/** 键 → 最小验证请求（各供应商 models 列表或 messages 最小调用；body 取最便宜模型；
 * headers 为按值构造的鉴权头——Anthropic 用 x-api-key + anthropic-version，其余 Bearer） */
const VERIFY_ENDPOINTS: Record<string, { url: string; body: unknown; modelHint?: string; headers: (value: string) => Record<string, string> }> = {
  DEEPSEEK_API_KEY: {
    url: 'https://api.deepseek.com/chat/completions',
    body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'deepseek-chat',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  OPENAI_API_KEY: {
    url: 'https://api.openai.com/v1/chat/completions',
    body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'gpt-4o-mini',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  ANTHROPIC_API_KEY: {
    url: 'https://api.anthropic.com/v1/messages',
    body: { model: 'claude-3-5-haiku-20241022', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
    modelHint: 'claude-3-5-haiku',
    headers: (v) => ({ 'x-api-key': v, 'anthropic-version': '2023-06-01' }),
  },
  MOONSHOT_API_KEY: {
    url: 'https://api.moonshot.cn/v1/chat/completions',
    body: { model: 'moonshot-v1-8k', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'moonshot-v1-8k',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  DASHSCOPE_API_KEY: {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    body: { model: 'qwen-turbo', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'qwen-turbo',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  ZHIPUAI_API_KEY: {
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    body: { model: 'glm-4-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'glm-4-flash',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  ARK_API_KEY: {
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    body: { model: 'doubao-lite-4k', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'doubao-lite',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  SILICONFLOW_API_KEY: {
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    body: { model: 'Qwen/Qwen2.5-7B-Instruct', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'Qwen/Qwen2.5-7B-Instruct',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  OPENROUTER_API_KEY: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    body: { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
    modelHint: 'openai/gpt-4o-mini',
    headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
}

/** 导入已验证凭据：渲染层把已勾选且验证通过的键连同 daemon 侧落盘动作完成后调用，
 * 主进程释放对应值（内存最小持有）。返回是否曾持有 */
export function takeCredentialValue(key: string): string | undefined {
  const value = credentialValues.get(key)
  credentialValues.delete(key)
  return value
}

const PROBE_IPC = {
  run: 'mx-wizard-probe:run',
  verify: 'mx-wizard-probe:verify-credential',
  take: 'mx-wizard-probe:take-credential',
} as const

/** IPC 通道族按需安装：向导窗创建时调用；重复调用幂等（ipcMain.handle 重复注册会抛错） */
export function installProbeIpc(): void {
  ipcMain.removeHandler(PROBE_IPC.run)
  ipcMain.removeHandler(PROBE_IPC.verify)
  ipcMain.removeHandler(PROBE_IPC.take)
  ipcMain.handle(PROBE_IPC.run, () => runProbe())
  ipcMain.handle(PROBE_IPC.verify, (_event, key: unknown) => {
    if (typeof key !== 'string') return { ok: false, reason: '非法参数' }
    return verifyCredential(key)
  })
  ipcMain.handle(PROBE_IPC.take, (_event, key: unknown) => {
    if (typeof key !== 'string') return null
    return takeCredentialValue(key) ?? null
  })
}

/** 向导窗销毁时卸载通道族（deepseek-harness 先例：通道族仅在其窗口存在期间安装） */
export function uninstallProbeIpc(): void {
  for (const channel of Object.values(PROBE_IPC)) ipcMain.removeHandler(channel)
  credentialValues.clear()
}
